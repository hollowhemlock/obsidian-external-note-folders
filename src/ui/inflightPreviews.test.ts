import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { InflightPreviews } from './inflightPreviews.ts';

describe('preview sharing', () => {
  it('coalesces identical running requests without reusing completed checks', async () => {
    const pool = new InflightPreviews<number>();
    let finish!: (value: number) => void;
    const check = vi.fn(async () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      })
    );
    const first = pool.run('same', new AbortController().signal, check);
    const second = pool.run('same', new AbortController().signal, check);
    expect(check).toHaveBeenCalledTimes(1);
    finish(1);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    const third = pool.run('same', new AbortController().signal, check);
    expect(check).toHaveBeenCalledTimes(2);
    finish(2);
    expect(await third).toBe(2);
  });
  it('cancels one subscriber without cancelling another subscriber', async () => {
    const pool = new InflightPreviews<number>();
    const firstControl = new AbortController();
    let finish!: (value: number) => void;
    let shared!: AbortSignal;
    async function check(signal: AbortSignal): Promise<number> {
      shared = signal;
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    }
    const first = pool.run('same', firstControl.signal, check);
    const second = pool.run('same', new AbortController().signal, check);
    firstControl.abort(new Error('cancel'));
    await expect(first).rejects.toThrow('cancel');
    expect(shared.aborted).toBe(false);
    finish(2);
    expect(await second).toBe(2);
  });
});
