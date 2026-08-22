import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import { type HttpNodeConfig, HttpNodeExecutor } from "../HttpNodeExecutor";

describe("HttpNodeExecutor", () => {
  let mockInstance: WorkflowInstance;

  beforeEach(() => {
    mockInstance = {
      instanceId: "test-instance",
      workflowId: "test-workflow",
      currentNodes: [],
      status: "running",
      context: {
        apiKey: "test-key",
        userId: "123",
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: {
        nodes: {
          "previous-node": {
            output: {
              data: "test-data",
              value: 42,
            },
          },
        },
      },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("execute", () => {
    it("should execute a simple GET request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ id: 1, title: "Test Post" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/1",
      };

      const result = await HttpNodeExecutor.execute(config, mockInstance);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ id: 1, title: "Test Post" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://jsonplaceholder.typicode.com/posts/1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should execute a POST request with body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 201,
        statusText: "Created",
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            id: 101,
            title: "Test Post",
            body: "Test content",
            userId: 1,
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "POST",
        url: "https://jsonplaceholder.typicode.com/posts",
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          title: "Test Post",
          body: "Test content",
          userId: 1,
        },
      };

      const result = await HttpNodeExecutor.execute(config, mockInstance);

      expect(result.status).toBe(201);
      expect(result.body.title).toBe("Test Post");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://jsonplaceholder.typicode.com/posts",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(config.body),
        }),
      );
    });

    it("should evaluate expressions in URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ id: 1 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/${context.userId}",
      };

      mockInstance.context.userId = "1";

      const result = await HttpNodeExecutor.execute(config, mockInstance);

      expect(result.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://jsonplaceholder.typicode.com/posts/1",
        expect.anything(),
      );
    });

    it("should evaluate expressions in headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/1",
        headers: {
          "X-API-Key": "${context.apiKey}",
        },
      };

      await HttpNodeExecutor.execute(config, mockInstance);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-key",
          }),
        }),
      );
    });

    it("should handle timeout", async () => {
      const mockFetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          const error = new Error("The user aborted a request.");
          error.name = "AbortError";
          setTimeout(() => reject(error), 50);
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://httpbin.org/delay/5",
        timeout: 10,
      };

      await expect(
        HttpNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/timeout/i);
    });

    it("should retry on failure with linear backoff", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network Error"))
        .mockRejectedValueOnce(new Error("Network Error"))
        .mockResolvedValue({
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ success: true }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://example.com/api",
        retryPolicy: {
          maxRetries: 2,
          backoff: "linear",
          initialDelay: 1,
        },
      };

      const result = await HttpNodeExecutor.execute(config, mockInstance);
      expect(result.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should handle 404 errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/999999",
      };

      await expect(
        HttpNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/404/);
    });

    it("should use custom status validation", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/999999",
        validateStatus: (status) => status === 404,
      };

      const result = await HttpNodeExecutor.execute(config, mockInstance);
      expect(result.status).toBe(404);
    });

    it("should handle JSON response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ id: 1 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://jsonplaceholder.typicode.com/posts/1",
      };

      const result = await HttpNodeExecutor.execute(config, mockInstance);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ id: 1 });
    });

    it("should handle text response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve("<html><body>Hello</body></html>"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: HttpNodeConfig = {
        method: "GET",
        url: "https://example.com/page",
      };

      const result = await HttpNodeExecutor.execute(config, mockInstance);
      expect(result.status).toBe(200);
      expect(result.body).toBe("<html><body>Hello</body></html>");
    });
  });
});
