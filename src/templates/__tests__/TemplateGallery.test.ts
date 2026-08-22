import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowTemplate } from "../TemplateGallery";
import { TemplateGallery } from "../TemplateGallery";

describe("TemplateGallery", () => {
  let gallery: TemplateGallery;

  beforeEach(() => {
    gallery = new TemplateGallery();
  });

  const mockTemplate: WorkflowTemplate = {
    id: "order-processing",
    name: "Order Processing",
    description: "Process customer orders with validation and notification",
    category: "ecommerce",
    tags: ["order", "payment", "notification"],
    difficulty: "intermediate",
    definition: {
      id: "order-processing",
      name: "Order Processing",
      startNode: "validate",
      nodes: {
        validate: {
          id: "validate",
          type: "action",
          next: ["process"],
        },
        process: {
          id: "process",
          type: "action",
          next: ["notify"],
        },
        notify: {
          id: "notify",
          type: "notification",
          config: {
            channel: "email",
            target: "${param.email}",
          },
        },
      },
    },
    parameters: [
      {
        name: "email",
        type: "string",
        description: "Customer email",
        required: true,
      },
      {
        name: "amount",
        type: "number",
        description: "Order amount",
        required: false,
        defaultValue: 0,
      },
    ],
    examples: [
      {
        name: "Basic order",
        description: "Simple order processing",
        input: { email: "test@example.com", amount: 100 },
      },
    ],
    author: "test",
    version: "1.0.0",
    downloads: 0,
    rating: 4.5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  describe("register and getById", () => {
    it("should register and retrieve a template", () => {
      gallery.register(mockTemplate);

      const retrieved = gallery.getById("order-processing");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("Order Processing");
    });

    it("should return undefined for non-existent template", () => {
      const result = gallery.getById("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("listAll", () => {
    it("should list all registered templates", () => {
      gallery.register(mockTemplate);

      const all = gallery.listAll();
      expect(all.length).toBe(1);
    });
  });

  describe("listByCategory", () => {
    it("should filter templates by category", () => {
      gallery.register(mockTemplate);

      const ecommerce = gallery.listByCategory("ecommerce");
      expect(ecommerce.length).toBe(1);

      const other = gallery.listByCategory("other");
      expect(other.length).toBe(0);
    });
  });

  describe("searchByTags", () => {
    it("should find templates by tags", () => {
      gallery.register(mockTemplate);

      const results = gallery.searchByTags(["order"]);
      expect(results.length).toBe(1);

      const noResults = gallery.searchByTags(["nonexistent"]);
      expect(noResults.length).toBe(0);
    });
  });

  describe("search", () => {
    it("should perform full-text search", () => {
      gallery.register(mockTemplate);

      const results = gallery.search("order processing");
      expect(results.length).toBe(1);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe("instantiate", () => {
    it("should instantiate template with parameters", () => {
      gallery.register(mockTemplate);

      const definition = gallery.instantiate("order-processing", {
        email: "user@example.com",
        amount: 100,
      });

      expect(definition).toBeDefined();
      expect(definition.id).toBe("order-processing");
    });

    it("should throw for missing required parameters", () => {
      gallery.register(mockTemplate);

      expect(() => {
        gallery.instantiate("order-processing", {});
      }).toThrow("Missing required parameter: email");
    });

    it("should use default values for optional parameters", () => {
      gallery.register(mockTemplate);

      const definition = gallery.instantiate("order-processing", {
        email: "user@example.com",
      });

      expect(definition).toBeDefined();
    });

    it("should throw for non-existent template", () => {
      expect(() => {
        gallery.instantiate("non-existent", {});
      }).toThrow("Template not found");
    });
  });

  describe("unregister", () => {
    it("should remove a template", () => {
      gallery.register(mockTemplate);

      const deleted = gallery.unregister("order-processing");
      expect(deleted).toBe(true);

      const result = gallery.getById("order-processing");
      expect(result).toBeUndefined();
    });

    it("should return false for non-existent template", () => {
      const deleted = gallery.unregister("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return template statistics", () => {
      gallery.register(mockTemplate);

      const stats = gallery.getStats();
      expect(stats.totalTemplates).toBe(1);
      expect(stats.categories).toBe(1);
      expect(stats.averageRating).toBe(4.5);
    });
  });
});
