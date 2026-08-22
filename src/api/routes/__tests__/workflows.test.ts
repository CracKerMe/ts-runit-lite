import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../../../model/Workflow";
import { MemoryStorage } from "../../../storage/MemoryStorage";
import type { StoredWorkflow } from "../../../storage/StorageProvider";

/**
 * Workflow CRUD API Tests
 * Tests the workflow management endpoints
 */

describe("Workflow CRUD API", () => {
  let storage: MemoryStorage;

  beforeAll(async () => {
    storage = new MemoryStorage();
    await storage.connect();
  });

  afterAll(async () => {
    await storage.close();
  });

  const validWorkflowDefinition: WorkflowDefinition = {
    id: "test-workflow",
    name: "Test Workflow",
    version: "1.0.0",
    startNode: "start",
    nodes: {
      start: {
        id: "start",
        type: "action",
        next: ["end"],
      },
      end: {
        id: "end",
        type: "action",
        next: [],
      },
    },
  };

  describe("Create Workflow", () => {
    it("should create workflow with metadata", async () => {
      const workflow: StoredWorkflow = {
        id: "create-test-1",
        name: "Create Test Workflow",
        description: "Test workflow for creation",
        definition: validWorkflowDefinition,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ["test", "demo"],
      };

      await storage.saveWorkflowWithMetadata(workflow);

      const retrieved = await storage.loadWorkflowWithMetadata("create-test-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Create Test Workflow");
      expect(retrieved?.version).toBe(1);
      expect(retrieved?.tags).toEqual(["test", "demo"]);
    });

    it("should prevent duplicate workflow creation", async () => {
      const workflow: StoredWorkflow = {
        id: "duplicate-test",
        name: "Duplicate Test",
        definition: validWorkflowDefinition,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.saveWorkflowWithMetadata(workflow);

      // Check if workflow exists
      const existing = await storage.loadWorkflowWithMetadata("duplicate-test");
      expect(existing).toBeDefined();
    });
  });

  describe("Retrieve Workflow", () => {
    it("should retrieve workflow by ID", async () => {
      const workflow: StoredWorkflow = {
        id: "retrieve-test-1",
        name: "Retrieve Test Workflow",
        definition: validWorkflowDefinition,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.saveWorkflowWithMetadata(workflow);

      const retrieved =
        await storage.loadWorkflowWithMetadata("retrieve-test-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("retrieve-test-1");
      expect(retrieved?.name).toBe("Retrieve Test Workflow");
    });

    it("should return null for non-existent workflow", async () => {
      const retrieved = await storage.loadWorkflowWithMetadata("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("List Workflows", () => {
    it("should list all workflows with metadata", async () => {
      // Create multiple workflows
      const workflows: StoredWorkflow[] = [
        {
          id: "list-test-1",
          name: "List Test 1",
          definition: validWorkflowDefinition,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "list-test-2",
          name: "List Test 2",
          definition: validWorkflowDefinition,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      for (const workflow of workflows) {
        await storage.saveWorkflowWithMetadata(workflow);
      }

      const allWorkflows = await storage.listWorkflowsWithMetadata();
      expect(allWorkflows.length).toBeGreaterThanOrEqual(2);

      const listTestWorkflows = allWorkflows.filter((w) =>
        w.id.startsWith("list-test-"),
      );
      expect(listTestWorkflows.length).toBe(2);
    });
  });

  describe("Update Workflow", () => {
    it("should update workflow and increment version", async () => {
      const workflow: StoredWorkflow = {
        id: "update-test-1",
        name: "Update Test Workflow",
        description: "Original description",
        definition: validWorkflowDefinition,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.saveWorkflowWithMetadata(workflow);

      // Update workflow
      const updatedWorkflow: StoredWorkflow = {
        ...workflow,
        name: "Updated Workflow Name",
        description: "Updated description",
        version: 2,
        updatedAt: Date.now(),
      };

      await storage.saveWorkflowWithMetadata(updatedWorkflow);

      const retrieved = await storage.loadWorkflowWithMetadata("update-test-1");
      expect(retrieved?.name).toBe("Updated Workflow Name");
      expect(retrieved?.description).toBe("Updated description");
      expect(retrieved?.version).toBe(2);
    });
  });

  describe("Delete Workflow", () => {
    it("should delete workflow", async () => {
      const workflow: StoredWorkflow = {
        id: "delete-test-1",
        name: "Delete Test Workflow",
        definition: validWorkflowDefinition,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storage.saveWorkflowWithMetadata(workflow);

      // Verify it exists
      let retrieved = await storage.loadWorkflowWithMetadata("delete-test-1");
      expect(retrieved).toBeDefined();

      // Delete it
      await storage.deleteWorkflow("delete-test-1");

      // Verify it's gone
      retrieved = await storage.loadWorkflowWithMetadata("delete-test-1");
      expect(retrieved).toBeNull();
    });
  });
});
