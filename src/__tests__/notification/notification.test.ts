import { describe, expect, it, vi } from "vitest";
import { NotificationNodeExecutor } from "../../engine/executors/NotificationNodeExecutor";
import type { WorkflowInstance } from "../../model/Instance";
import type { NotificationNodeConfig } from "../../model/Workflow";
import { DingtalkChannel } from "../../notification/channels/DingtalkChannel";
import { EmailChannel } from "../../notification/channels/EmailChannel";
import { FeishuChannel } from "../../notification/channels/FeishuChannel";
import { SlackChannel } from "../../notification/channels/SlackChannel";
import { WebhookChannel } from "../../notification/channels/WebhookChannel";
import { setupNotificationChannelsFromEnv } from "../../notification/index";
import { NotificationManager } from "../../notification/NotificationManager";

function okFetch() {
  return vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
}

describe("NotificationManager", () => {
  it("should register channels and dispatch messages", async () => {
    const manager = new NotificationManager();
    const send = vi.fn().mockResolvedValue({ ok: true, channel: "custom" });
    manager.registerChannel({
      name: "custom",
      send,
      validate: async () => true,
    });

    const result = await manager.send("custom", {
      target: "#room",
      body: "hello",
    });

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ target: "#room", body: "hello" });
    expect(manager.listChannels()).toContain("custom");
  });

  it("should throw for unregistered channels", async () => {
    const manager = new NotificationManager();
    await expect(
      manager.send("nope", { target: "x", body: "y" }),
    ).rejects.toThrow(/not registered/);
  });

  it("should render handlebars and expression placeholders", () => {
    const manager = new NotificationManager();
    const rendered = manager.renderMessage(
      {
        target: "#{{context.team}}",
        subject: "订单 {{orderId}}",
        body: "实例 ${notify.output.status} 处理人 {{owner}}",
      },
      {
        orderId: "ORD-1",
        owner: "alice",
        context: { team: "ops" },
      },
      {
        nodes: {
          notify: {
            output: { status: "completed" },
          },
        },
      },
    );

    expect(rendered.target).toBe("#ops");
    expect(rendered.subject).toBe("订单 ORD-1");
    expect(rendered.body).toBe("实例 completed 处理人 alice");
  });
});

describe("SlackChannel", () => {
  it("should POST Slack text payload to webhook", async () => {
    const fetchImpl = okFetch();
    const channel = new SlackChannel({
      webhookUrl: "https://hooks.slack.com/services/T/B/X",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await channel.send({
      target: "#alerts",
      body: "新订单 ORD-1",
      severity: "info",
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("slack");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T/B/X");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.text).toContain("新订单 ORD-1");
    expect(payload.channel).toBe("#alerts");
  });

  it("should report failure on non-2xx response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 500 }));
    const channel = new SlackChannel({
      webhookUrl: "https://hooks.slack.com/x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await channel.send({ target: "#a", body: "b" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});

describe("FeishuChannel", () => {
  it("should POST Feishu text payload", async () => {
    const fetchImpl = okFetch();
    const channel = new FeishuChannel({
      webhookUrl: "https://open.feishu.cn/hook/x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await channel.send({ target: "ops", body: "hello" });

    const payload = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(payload.msg_type).toBe("text");
    expect(payload.content.text).toContain("hello");
  });
});

describe("DingtalkChannel", () => {
  it("should POST Dingtalk text payload", async () => {
    const fetchImpl = okFetch();
    const channel = new DingtalkChannel({
      webhookUrl: "https://oapi.dingtalk.com/robot/x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await channel.send({ target: "ops", body: "hello" });

    const payload = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(payload.msgtype).toBe("text");
    expect(payload.text.content).toContain("hello");
  });
});

describe("WebhookChannel", () => {
  it("should POST raw notification payload to target url", async () => {
    const fetchImpl = okFetch();
    const channel = new WebhookChannel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await channel.send({
      target: "https://example.com/hook",
      body: "payload",
      severity: "critical",
      data: { a: 1 },
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.body).toBe("payload");
    expect(payload.severity).toBe("critical");
    expect(payload.data).toEqual({ a: 1 });
  });
});

describe("EmailChannel", () => {
  it("should send through injected transport", async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({ id: "m1" }) };
    const channel = new EmailChannel({
      transport,
      from: "noreply@example.com",
    });

    const result = await channel.send({
      target: "ops@example.com",
      subject: "警报",
      body: "工作流失败",
    });

    expect(result.ok).toBe(true);
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "ops@example.com",
      subject: "警报",
      text: "工作流失败",
    });
  });

  it("should fail validation without transport-provided config", async () => {
    const transport = {
      sendMail: vi.fn().mockRejectedValue(new Error("smtp down")),
    };
    const channel = new EmailChannel({ transport, from: "a@b.com" });
    const result = await channel.send({ target: "x@y.com", body: "t" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/smtp down/);
  });
});

describe("setupNotificationChannelsFromEnv", () => {
  it("should register env-backed channels and default webhook", () => {
    const originalSlack = process.env.SLACK_WEBHOOK_URL;
    const originalFeishu = process.env.FEISHU_WEBHOOK_URL;
    const originalDingtalk = process.env.DINGTALK_WEBHOOK_URL;
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/X";
    process.env.FEISHU_WEBHOOK_URL = "https://open.feishu.cn/hook/x";
    process.env.DINGTALK_WEBHOOK_URL = "https://oapi.dingtalk.com/robot/x";

    try {
      const manager = setupNotificationChannelsFromEnv({
        manager: new NotificationManager(),
      });

      expect(manager.listChannels()).toEqual(
        expect.arrayContaining(["slack", "feishu", "dingtalk", "webhook"]),
      );
    } finally {
      process.env.SLACK_WEBHOOK_URL = originalSlack;
      process.env.FEISHU_WEBHOOK_URL = originalFeishu;
      process.env.DINGTALK_WEBHOOK_URL = originalDingtalk;
    }
  });
});

describe("NotificationNodeExecutor", () => {
  it("should interpolate config and send through manager", async () => {
    const manager = new NotificationManager();
    const send = vi.fn().mockResolvedValue({ ok: true, channel: "slack" });
    manager.registerChannel({
      name: "slack",
      send,
      validate: async () => true,
    });

    const config: NotificationNodeConfig = {
      channel: "slack",
      target: "#{{context.team}}",
      subject: "订单 {{orderId}}",
      template: "状态 ${notify.output.status}",
      severity: "warning",
      data: {
        owner: "{{owner}}",
      },
    };

    const instance: WorkflowInstance = {
      instanceId: "inst-1",
      workflowId: "wf-1",
      currentNodes: [],
      status: "running",
      context: {
        orderId: "ORD-1",
        owner: "alice",
        team: "ops",
      },
      state: {
        nodes: {
          notify: {
            output: { status: "failed" },
          },
        },
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await NotificationNodeExecutor.execute(
      config,
      instance,
      manager,
    );

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({
      target: "#ops",
      subject: "订单 ORD-1",
      body: "状态 failed",
      severity: "warning",
      data: {
        owner: "alice",
      },
    });
  });
});
