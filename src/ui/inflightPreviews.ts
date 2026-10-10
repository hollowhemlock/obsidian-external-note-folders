/** Share only running work; completed checks are never execution authority. */
export class InflightPreviews<T> {
  private readonly pending = new Map<string, { controller: AbortController; promise: Promise<T>; users: number }>();
  public clear(): void {
    for (const entry of this.pending.values()) {
      entry.controller.abort();
    }
    this.pending.clear();
  }

  public async run(key: string, signal: AbortSignal, inspect: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let entry = this.pending.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      entry = { controller, promise: inspect(controller.signal), users: 0 };
      this.pending.set(key, entry);
    }
    const captured = entry;
    captured.users++;
    let cancelled: (() => void) | undefined;
    try {
      return await Promise.race([
        captured.promise,
        new Promise<never>((_resolve, reject) => {
          cancelled = (): void => {
            reject(signal.reason instanceof Error ? signal.reason : new Error('Preview cancelled.'));
          };
          signal.addEventListener('abort', cancelled, { once: true });
        })
      ]);
    } finally {
      if (cancelled) {
        signal.removeEventListener('abort', cancelled);
      }
      captured.users--;
      if (!captured.users) {
        captured.controller.abort();
        // Let cancelled IO settle before callers can mistake it for completed work.
        await captured.promise.catch(() => undefined);
        if (this.pending.get(key) === captured) {
          this.pending.delete(key);
        }
      }
    }
  }
}
