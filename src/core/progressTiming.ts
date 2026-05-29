export const DEFAULT_PROGRESS_MODAL_MIN_VISIBLE_MS = 750;

export async function waitForMinimumVisibleDuration(input: {
  minimumVisibleMs: number;
  now: () => number;
  openedAtMs: number;
  sleep: (durationMs: number) => Promise<void>;
}): Promise<void> {
  if (!Number.isFinite(input.minimumVisibleMs) || input.minimumVisibleMs <= 0) {
    return;
  }

  const elapsedMs = input.now() - input.openedAtMs;
  if (!Number.isFinite(elapsedMs)) {
    return;
  }

  const clampedElapsedMs = Math.max(0, elapsedMs);
  const remainingMs = input.minimumVisibleMs - clampedElapsedMs;
  if (remainingMs <= 0) {
    return;
  }

  await input.sleep(remainingMs);
}
