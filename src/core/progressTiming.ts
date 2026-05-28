export const DEFAULT_PROGRESS_MODAL_MIN_VISIBLE_MS = 750;

export async function waitForMinimumVisibleDuration(input: {
  minimumVisibleMs: number;
  now: () => number;
  openedAtMs: number;
  sleep: (durationMs: number) => Promise<void>;
}): Promise<void> {
  const elapsedMs = input.now() - input.openedAtMs;
  const remainingMs = input.minimumVisibleMs - elapsedMs;
  if (remainingMs <= 0) {
    return;
  }

  await input.sleep(remainingMs);
}
