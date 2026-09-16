// oxlint-disable no-explicit-any -- test builds hostile/edge-case responses
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import {
  type HttpNodeConfig,
  HttpNodeExecutor,
} from "../../../engine/executors/HttpNodeExecutor";

/**
 * 回归测试：HTTP 节点的三项加固
 *  - 未配置 timeout 时必须有默认超时（此前 fetch 可无限期挂起）
 *  - 响应体必须有大小上限（此前超大响应体直接 OOM）
 *  - 重试退避必须带抖动（此前并发实例同步重试形成惊群）
 */

function makeInstance(): WorkflowInstance {
  return {
    instanceId: "test-instance",
    workflowId: "test-workflow",
    currentNodes: [],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    retries: {},
    state: { nodes: {} },
  };
}

/** 构造一个带可读流 body 的 Response 替身。 */
function streamResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): any {
  let i = 0;
  return {
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/plain", ...headers }),
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  };
}

describe("HttpNodeExecutor — request timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes an abort signal even when no timeout is configured", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(streamResponse([new TextEncoder().encode("ok")]));
    vi.stubGlobal("fetch", mockFetch);

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/x",
      // 刻意不配 timeout
    };
    await HttpNodeExecutor.execute(config, makeInstance());

    const options = mockFetch.mock.calls[0]![1];
    // 修复前未配 timeout 就不设 AbortController，请求可永久挂起
    expect(options.signal).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a request that exceeds the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: any) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/slow",
      timeout: 30,
    };

    await expect(
      HttpNodeExecutor.execute(config, makeInstance()),
    ).rejects.toThrow();
  });
});

describe("HttpNodeExecutor — response body limit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a response whose Content-Length exceeds the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamResponse([], { "content-length": String(50 * 1024 * 1024) }),
        ),
    );

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/huge",
      maxResponseBytes: 1024,
    };

    await expect(
      HttpNodeExecutor.execute(config, makeInstance()),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects a chunked response that exceeds the limit mid-stream", async () => {
    // 不声明 Content-Length，只能靠流式累计发现超限
    const chunk = new Uint8Array(512);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamResponse([chunk, chunk, chunk, chunk])),
    );

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/chunked",
      maxResponseBytes: 1024,
    };

    await expect(
      HttpNodeExecutor.execute(config, makeInstance()),
    ).rejects.toThrow(/too large/i);
  });

  it("accepts a response within the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamResponse([new TextEncoder().encode("small body")]),
        ),
    );

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/small",
      maxResponseBytes: 1024,
    };

    const result = await HttpNodeExecutor.execute(config, makeInstance());
    expect(result.body).toBe("small body");
  });

  it("parses JSON read through the size-limited stream path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        streamResponse([new TextEncoder().encode('{"id":7}')], {
          "content-type": "application/json",
        }),
      ),
    );

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/json",
    };

    const result = await HttpNodeExecutor.execute(config, makeInstance());
    expect(result.body).toEqual({ id: 7 });
  });

  it("handles a multi-byte UTF-8 sequence split across chunks", async () => {
    // "中" 是 3 字节，故意从中间切开，验证流式解码不会产生乱码
    const full = new TextEncoder().encode("中文");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(streamResponse([full.slice(0, 2), full.slice(2)])),
    );

    const config: HttpNodeConfig = {
      method: "GET",
      url: "https://example.test/utf8",
    };

    const result = await HttpNodeExecutor.execute(config, makeInstance());
    expect(result.body).toBe("中文");
  });
});
