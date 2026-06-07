import { AsyncLocalStorage } from "node:async_hooks";

type ExecutionContextLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
  ctx?: ExecutionContextLike;
  context?: ExecutionContextLike;
  executionCtx?: ExecutionContextLike;
};

const executionContextStorage = new AsyncLocalStorage<ExecutionContextLike | undefined>();

function getWaitUntil(
  ctx: ExecutionContextLike | undefined,
): ((promise: Promise<unknown>) => void) | undefined {
  if (!ctx) return undefined;
  if (typeof ctx.waitUntil === "function") return ctx.waitUntil.bind(ctx);
  return getWaitUntil(ctx.executionCtx) ?? getWaitUntil(ctx.context) ?? getWaitUntil(ctx.ctx);
}

export async function runWithExecutionContext<T>(
  ctx: unknown,
  callback: () => T | Promise<T>,
): Promise<T> {
  return executionContextStorage.run(
    ctx as ExecutionContextLike | undefined,
    async () => await callback(),
  );
}

export function waitUntil(promise: Promise<unknown>) {
  const waitForBackgroundTask = getWaitUntil(executionContextStorage.getStore());
  const guardedPromise = promise.catch((error) => {
    console.error("Background task failed:", error);
  });

  if (waitForBackgroundTask) {
    waitForBackgroundTask(guardedPromise);
    return;
  }

  void guardedPromise;
}
