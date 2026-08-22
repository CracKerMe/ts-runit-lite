export type SearchAttributeValue = string | number | boolean | Date;

export interface SearchAttribute {
  key: string;
  value: SearchAttributeValue;
  type: "keyword" | "int" | "double" | "bool" | "datetime";
}

export interface SearchAttributeDefinition {
  name: string;
  type: "keyword" | "int" | "double" | "bool" | "datetime";
  description?: string;
}

export interface SearchQuery {
  workflowId?: string;
  workflowType?: string;
  status?: string[];
  startTime?: { from?: Date; to?: Date };
  endTime?: { from?: Date; to?: Date };
  attributes?: Record<string, SearchAttributeValue>;
  offset?: number;
  limit?: number;
}

/** Metadata carried alongside an instance's indexed attributes. */
export interface IndexMeta {
  workflowId?: string;
  status?: string;
}

interface IndexEntry {
  instanceId: string;
  workflowId?: string;
  status?: string;
  attributes: Map<string, SearchAttributeValue>;
}

export class SearchAttributeManager {
  private definitions: Map<string, SearchAttributeDefinition> = new Map();
  /** Indexed by instanceId — a workflow can have many concurrent instances. */
  private indexes: Map<string, IndexEntry> = new Map();

  registerAttribute(definition: SearchAttributeDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  registerAttributes(definitions: SearchAttributeDefinition[]): void {
    for (const def of definitions) {
      this.registerAttribute(def);
    }
  }

  getDefinition(name: string): SearchAttributeDefinition | undefined {
    return this.definitions.get(name);
  }

  listDefinitions(): SearchAttributeDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Index (or update) an instance's search attributes.
   * @param instanceId Unique instance key.
   * @param attributes Attribute values (only registered attributes are stored).
   * @param meta Optional workflowId / status metadata used by status queries.
   */
  index(
    instanceId: string,
    attributes: Record<string, SearchAttributeValue>,
    meta?: IndexMeta,
  ): void {
    let entry = this.indexes.get(instanceId);
    if (!entry) {
      entry = { instanceId, attributes: new Map() };
      this.indexes.set(instanceId, entry);
    }

    if (meta?.workflowId !== undefined) {
      entry.workflowId = meta.workflowId;
    }
    if (meta?.status !== undefined) {
      entry.status = meta.status;
    }

    for (const [key, value] of Object.entries(attributes)) {
      const definition = this.definitions.get(key);
      if (definition) {
        const normalizedValue = this.normalizeValue(value, definition.type);
        entry.attributes.set(key, normalizedValue);
      }
    }
  }

  /** Update only the status of an already-indexed instance. */
  updateStatus(instanceId: string, status: string): void {
    const entry = this.indexes.get(instanceId);
    if (entry) {
      entry.status = status;
    }
  }

  removeIndex(instanceId: string): void {
    this.indexes.delete(instanceId);
  }

  getIndex(
    instanceId: string,
  ): Record<string, SearchAttributeValue> | undefined {
    const entry = this.indexes.get(instanceId);
    if (!entry) return undefined;
    return Object.fromEntries(entry.attributes);
  }

  query(query: SearchQuery): string[] {
    let results = Array.from(this.indexes.values());

    if (query.workflowId) {
      results = results.filter(
        (entry) => entry.workflowId === query.workflowId,
      );
    }

    if (query.status && query.status.length > 0) {
      results = results.filter(
        (entry) =>
          entry.status !== undefined && query.status!.includes(entry.status),
      );
    }

    if (query.attributes) {
      results = results.filter((entry) => {
        for (const [key, value] of Object.entries(query.attributes!)) {
          if (entry.attributes.get(key) !== value) {
            return false;
          }
        }
        return true;
      });
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    return results
      .slice(offset, offset + limit)
      .map((entry) => entry.instanceId);
  }

  count(query: SearchQuery): number {
    return this.query({ ...query, limit: 10000 }).length;
  }

  private normalizeValue(
    value: SearchAttributeValue,
    type: SearchAttributeDefinition["type"],
  ): SearchAttributeValue {
    switch (type) {
      case "int":
        return typeof value === "number"
          ? Math.floor(value)
          : Number.parseInt(String(value), 10);
      case "double":
        return typeof value === "number"
          ? value
          : Number.parseFloat(String(value));
      case "bool":
        return Boolean(value);
      case "datetime":
        if (value instanceof Date) return value;
        if (typeof value === "string" || typeof value === "number") {
          return new Date(value);
        }
        return new Date();
      default:
        return String(value);
    }
  }
}

export const searchAttributeManager = new SearchAttributeManager();
