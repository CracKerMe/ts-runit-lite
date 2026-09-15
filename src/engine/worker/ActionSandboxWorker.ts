import { parentPort } from "node:worker_threads";
import { runInVmSandbox } from "../SandboxEvaluator";
import type {
  EvaluateMessage,
  WorkerReplyMessage,
} from "./ActionSandboxMessage";

if (!parentPort) {
  throw new Error("ActionSandboxWorker must be run as a worker thread");
}

// Each worker thread is its own V8 isolate with its own heap: an action
// string that hangs or corrupts state here cannot touch the main thread's
// event loop or objects, and a timeout is enforced by terminate()-ing this
// whole thread from ActionSandboxPool rather than relying on vm's
// cooperative-only Script timeout.
parentPort.on("message", (message: EvaluateMessage): void => {
  if (message.type !== "evaluate") return;

  const { expression, context, timeoutMs } = message.payload;
  let reply: WorkerReplyMessage;
  try {
    const result = runInVmSandbox(expression, context, { timeoutMs });
    reply = { type: "result", taskId: message.taskId, payload: { result } };
  } catch (error: unknown) {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    reply = {
      type: "error",
      taskId: message.taskId,
      payload: { message: normalized.message, stack: normalized.stack },
    };
  }
  parentPort?.postMessage(reply);
});
