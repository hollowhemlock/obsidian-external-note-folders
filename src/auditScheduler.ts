export interface AuditScheduleOptions {
  onSlice?: (milliseconds: number) => void;
  signal?: AbortSignal;
}

/** Scheduling belongs to the host, not the domain generators. */
export async function runAuditSteps<T>(steps: Generator<void, T>, options: AuditScheduleOptions = {}): Promise<T> {
  const budgetMs = 8;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const started = performance.now();
      let step = steps.next();
      while (!step.done && performance.now() - started < budgetMs) {
        step = steps.next();
      }
      options.onSlice?.(performance.now() - started);
      if (step.done) {
        return step.value;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  } finally {
    steps.return(undefined as never);
  }
}
