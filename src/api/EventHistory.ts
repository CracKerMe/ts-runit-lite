// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { v4 as uuidv4 } from "uuid";
import type {
  EventRecord as StorageEventRecord,
  StorageProvider,
} from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";

export interface EventRecord {
  id: string;
  event: string;
  data: any;
  timestamp: Date;
  instanceId?: string;
  webhookDeliveries?: {
    webhookId: string;
    status: "success" | "failed";
    statusCode?: number;
    responseTime?: number;
    errorMessage?: string;
  }[];
  source: "api" | "system" | "webhook";
}

// Query parameters for event filtering
export interface EventQueryParams {
  instanceId?: string;
  eventType?: string;
  startTime?: number;
  endTime?: number;
  page?: number;
  pageSize?: number;
  sortBy?: "timestamp" | "eventType";
  sortOrder?: "asc" | "desc";
}

// Pagination metadata
export interface PaginationMetadata {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// Query response with pagination
export interface EventQueryResponse {
  events: EventRecord[];
  pagination: PaginationMetadata;
}

// Aggregation parameters
export interface EventAggregateParams {
  groupBy: "eventType" | "instanceId" | "workflowId";
  startTime?: number;
  endTime?: number;
}

// Aggregation result
export interface EventAggregateGroup {
  key: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface EventAggregateResponse {
  groups: EventAggregateGroup[];
}

/**
 * Records and queries workflow event history.
 *
 * Persists through the injected StorageProvider's generic event methods
 * (saveEvent/loadEvent/queryEvents/deleteEvent) — this lite fork has no
 * Redis backend, so there is no separate cache-style client to talk to.
 */
export class EventHistoryManager {
  private storage: StorageProvider | null = null;
  private readonly MAX_EVENTS = 1000; // 最大事件历史记录数
  private readonly FETCH_ALL_PAGE_SIZE = 10_000;
  /** 每写入多少条事件才做一次裁剪（摊还全量扫描开销）。 */
  private readonly TRIM_INTERVAL = 100;
  private writesSinceTrim = 0;

  constructor(storage?: StorageProvider) {
    if (storage) {
      this.storage = storage;
    }
  }

  private toStorageRecord(record: EventRecord): StorageEventRecord {
    return {
      id: record.id,
      instanceId: record.instanceId ?? "",
      workflowId: "",
      eventType: record.event,
      payload: record.data,
      timestamp: record.timestamp.getTime(),
      metadata: {
        source: record.source,
        webhookDeliveries: record.webhookDeliveries,
      },
    };
  }

  private fromStorageRecord(stored: StorageEventRecord): EventRecord {
    return {
      id: stored.id,
      event: stored.eventType,
      data: stored.payload,
      timestamp: new Date(stored.timestamp),
      instanceId: stored.instanceId || undefined,
      source:
        (stored.metadata?.source as EventRecord["source"] | undefined) ??
        "system",
      webhookDeliveries: stored.metadata?.webhookDeliveries as
        | EventRecord["webhookDeliveries"]
        | undefined,
    };
  }

  /**
   * 记录事件
   * @param event 事件名称
   * @param data 事件数据
   * @param source 事件来源
   * @param instanceId 可选的工作流实例ID
   * @returns 事件记录ID
   */
  async recordEvent(
    event: string,
    data: any,
    source: "api" | "system" | "webhook" = "system",
    instanceId?: string,
  ): Promise<string> {
    const id = uuidv4();
    const timestamp = new Date();

    const eventRecord: EventRecord = {
      id,
      event,
      data,
      timestamp,
      instanceId,
      source,
    };

    Logger.debug(
      "event-history",
      "record",
      `Recording event ${event} with ID ${id}`,
    );

    if (this.storage) {
      try {
        await this.storage.saveEvent(this.toStorageRecord(eventRecord));
        await this.trimEventHistory();
      } catch (error) {
        Logger.error(
          "event-history",
          "storage",
          `Failed to save event record: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return id;
  }

  /**
   * 记录webhook投递结果
   */
  async recordWebhookDelivery(
    eventId: string,
    webhookId: string,
    status: "success" | "failed",
    details: {
      statusCode?: number;
      responseTime?: number;
      errorMessage?: string;
    } = {},
  ): Promise<void> {
    if (!this.storage) return;

    try {
      const stored = await this.storage.loadEvent(eventId);
      if (!stored) {
        Logger.warn(
          "event-history",
          "webhook",
          `Event ${eventId} not found for webhook delivery recording`,
        );
        return;
      }

      const record = this.fromStorageRecord(stored);
      record.webhookDeliveries ??= [];
      record.webhookDeliveries.push({
        webhookId,
        status,
        statusCode: details.statusCode,
        responseTime: details.responseTime,
        errorMessage: details.errorMessage,
      });

      await this.storage.saveEvent(this.toStorageRecord(record));
    } catch (error) {
      Logger.error(
        "event-history",
        "webhook",
        `Failed to record webhook delivery: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 获取事件历史
   * @param limit 限制返回数量
   * @param offset 偏移量
   * @returns 事件记录数组
   */
  async getEvents(limit = 20, offset = 0): Promise<EventRecord[]> {
    if (!this.storage) return [];

    try {
      const { events } = await this.storage.queryEvents({
        page: 1,
        pageSize: this.FETCH_ALL_PAGE_SIZE,
      });

      return events
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(offset, offset + limit)
        .map((e) => this.fromStorageRecord(e));
    } catch (error) {
      Logger.error(
        "event-history",
        "query",
        `Failed to get events: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 按事件类型获取事件历史
   */
  async getEventsByType(
    eventType: string,
    limit = 20,
    offset = 0,
  ): Promise<EventRecord[]> {
    if (!this.storage) return [];

    try {
      const { events } = await this.storage.queryEvents({
        eventType,
        page: 1,
        pageSize: this.FETCH_ALL_PAGE_SIZE,
      });

      return events
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(offset, offset + limit)
        .map((e) => this.fromStorageRecord(e));
    } catch (error) {
      Logger.error(
        "event-history",
        "query",
        `Failed to get events by type: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 按实例ID获取事件历史
   */
  async getEventsByInstance(
    instanceId: string,
    limit = 20,
    offset = 0,
  ): Promise<EventRecord[]> {
    if (!this.storage) return [];

    try {
      const { events } = await this.storage.queryEvents({
        instanceId,
        page: 1,
        pageSize: this.FETCH_ALL_PAGE_SIZE,
      });

      return events
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(offset, offset + limit)
        .map((e) => this.fromStorageRecord(e));
    } catch (error) {
      Logger.error(
        "event-history",
        "query",
        `Failed to get events by instance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 获取特定事件记录
   */
  async getEvent(id: string): Promise<EventRecord | null> {
    if (!this.storage) return null;

    try {
      const stored = await this.storage.loadEvent(id);
      return stored ? this.fromStorageRecord(stored) : null;
    } catch (error) {
      Logger.error(
        "event-history",
        "query",
        `Failed to get event ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Query events with filtering and pagination
   */
  async queryEvents(params: EventQueryParams): Promise<EventQueryResponse> {
    if (!this.storage) {
      return {
        events: [],
        pagination: {
          page: params.page ?? 1,
          pageSize: params.pageSize ?? 20,
          totalCount: 0,
          totalPages: 0,
        },
      };
    }

    try {
      const page = params.page ?? 1;
      const pageSize = Math.min(params.pageSize ?? 20, 1000); // Enforce max page size
      const sortOrder = params.sortOrder ?? "desc";

      // Enforce time range limit (max 30 days)
      let endTime = params.endTime;
      if (params.startTime && endTime) {
        const rangeMs = endTime - params.startTime;
        const maxRangeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        if (rangeMs > maxRangeMs) {
          Logger.warn(
            "event-history",
            "query",
            `Time range ${Math.round(rangeMs / (24 * 60 * 60 * 1000))} days exceeds max 30 days, clamping`,
          );
          endTime = params.startTime + maxRangeMs;
        }
      }

      const { events: stored } = await this.storage.queryEvents({
        instanceId: params.instanceId,
        eventType: params.eventType,
        startTime: params.startTime,
        endTime,
        page: 1,
        pageSize: this.FETCH_ALL_PAGE_SIZE,
      });

      const sorted = stored
        .slice()
        .sort((a, b) =>
          sortOrder === "desc"
            ? b.timestamp - a.timestamp
            : a.timestamp - b.timestamp,
        );

      const totalCount = sorted.length;
      const totalPages = Math.ceil(totalCount / pageSize);

      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const events = sorted
        .slice(start, end)
        .map((e) => this.fromStorageRecord(e));

      return {
        events,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
        },
      };
    } catch (error) {
      Logger.error(
        "event-history",
        "query",
        `Failed to query events: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        events: [],
        pagination: {
          page: params.page ?? 1,
          pageSize: params.pageSize ?? 20,
          totalCount: 0,
          totalPages: 0,
        },
      };
    }
  }

  /**
   * Aggregate events by dimension
   */
  async aggregateEvents(
    params: EventAggregateParams,
  ): Promise<EventAggregateResponse> {
    if (!this.storage) {
      return { groups: [] };
    }

    try {
      const { events: stored } = await this.storage.queryEvents({
        startTime: params.startTime,
        endTime: params.endTime,
        page: 1,
        pageSize: this.FETCH_ALL_PAGE_SIZE,
      });

      const groups = new Map<
        string,
        { count: number; firstSeen: number; lastSeen: number }
      >();

      for (const record of stored) {
        let key: string;
        if (params.groupBy === "eventType") {
          key = record.eventType;
        } else if (params.groupBy === "instanceId") {
          key = record.instanceId || "unknown";
        } else {
          key = record.workflowId || "unknown";
        }

        const existing = groups.get(key);
        if (existing) {
          existing.count++;
          existing.firstSeen = Math.min(existing.firstSeen, record.timestamp);
          existing.lastSeen = Math.max(existing.lastSeen, record.timestamp);
        } else {
          groups.set(key, {
            count: 1,
            firstSeen: record.timestamp,
            lastSeen: record.timestamp,
          });
        }
      }

      const result: EventAggregateGroup[] = [];
      for (const [key, value] of groups.entries()) {
        result.push({
          key,
          count: value.count,
          firstSeen: value.firstSeen,
          lastSeen: value.lastSeen,
        });
      }

      result.sort((a, b) => b.count - a.count);

      return { groups: result };
    } catch (error) {
      Logger.error(
        "event-history",
        "aggregate",
        `Failed to aggregate events: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { groups: [] };
    }
  }

  /**
   * 清理旧的事件记录，保持事件历史在合理大小
   */
  private async trimEventHistory(): Promise<void> {
    if (!this.storage) return;

    // 每次写入都做一次全量拉取 + 内存排序，成本远高于写入本身。
    // 摊还成一批一次：MAX_EVENTS 是软上限，短暂超出 TRIM_INTERVAL 条无害。
    this.writesSinceTrim++;
    if (this.writesSinceTrim < this.TRIM_INTERVAL) return;
    this.writesSinceTrim = 0;

    try {
      const { events: stored, total } = await this.storage.queryEvents({
        page: 1,
        pageSize: this.FETCH_ALL_PAGE_SIZE,
      });

      if (total > this.MAX_EVENTS) {
        const toRemoveCount = total - this.MAX_EVENTS;
        const oldest = stored
          .slice()
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, toRemoveCount);

        for (const event of oldest) {
          await this.storage.deleteEvent(event.id);
        }

        Logger.debug(
          "event-history",
          "cleanup",
          `Removed ${oldest.length} old events to maintain history limit`,
        );
      }
    } catch (error) {
      Logger.error(
        "event-history",
        "cleanup",
        `Failed to trim event history: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
