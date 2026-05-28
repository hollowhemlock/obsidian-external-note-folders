import {
  describe,
  expect,
  it
} from 'vitest';

import { waitForMinimumVisibleDuration } from './progressTiming.ts';

describe('progressTiming', () => {
  it('waits for the remaining minimum visible duration', async () => {
    const sleeps: number[] = [];

    await waitForMinimumVisibleDuration({
      minimumVisibleMs: 750,
      now: () => 250,
      openedAtMs: 0,
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
      }
    });

    expect(sleeps).toEqual([500]);
  });

  it('does not wait when the minimum visible duration has elapsed', async () => {
    const sleeps: number[] = [];

    await waitForMinimumVisibleDuration({
      minimumVisibleMs: 750,
      now: () => 900,
      openedAtMs: 0,
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
      }
    });

    expect(sleeps).toEqual([]);
  });
});
