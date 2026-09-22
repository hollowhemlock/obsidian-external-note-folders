import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { AdoptionPreview } from './adoptionDialogState.ts';

import { AdoptionDialogState } from './adoptionDialogState.ts';

const preview: AdoptionPreview = {
  content: null,
  plan: {
    aliases: null,
    descendants: [],
    expectedFolder: '/root/Group',
    externalRoot: '/root',
    folderPath: '/root/Group',
    ignorePatterns: [],
    mutationSequence: 0,
    notePath: 'Group.md',
    sourcePath: null,
    uuid: 'identity',
    vaultRoot: '/vault',
    warnings: []
  }
};
function setup(): { check: ReturnType<typeof vi.fn<() => Promise<AdoptionPreview>>>; state: AdoptionDialogState } {
  vi.useFakeTimers();
  const check = vi.fn(async () => preview);
  const state = new AdoptionDialogState(() => ['A.md', 'Folder/A.md', 'B.md'], check, () => undefined);
  return { check, state };
}
afterEach(() => {
  vi.useRealTimers();
});
describe('adoption dialog state', () => {
  it('resolves exact paths, rejects incomplete names, and preserves existing-note mode', () => {
    const { state } = setup();
    state.edit('A');
    expect(state.source).toBe('A.md');
    expect(state.mode).toBe('bind');
    state.chooseMode('move');
    state.edit('B.md');
    expect(state.mode).toBe('move');
    state.edit('Folder');
    expect(state.source).toBeUndefined();
    expect(state.canConfirm).toBe(false);
    state.chooseMode('create');
    expect(state.source).toBeUndefined();
    state.edit('');
    expect(state.mode).toBe('create');
    expect(state.source).toBeNull();
    state.stop();
  });
  it('debounces, retries unchanged input, and resets acknowledgment', async () => {
    const { check, state } = setup();
    state.start();
    state.edit('A');
    await vi.advanceTimersByTimeAsync(399);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(state.canConfirm).toBe(true);
    check.mockResolvedValue({ ...preview, plan: { ...preview.plan, descendants: ['Child.md'] } });
    state.retry();
    expect(state.canConfirm).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(state.canConfirm).toBe(false);
    state.acknowledged = true;
    expect(state.canConfirm).toBe(true);
    state.chooseMode('move');
    expect(state.acknowledged).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(state.canConfirm).toBe(false);
    check.mockRejectedValueOnce(new Error('Temporary failure'));
    state.retry();
    await vi.advanceTimersByTimeAsync(400);
    expect(state.phase).toBe('error');
    state.retry();
    await vi.advanceTimersByTimeAsync(400);
    expect(state.phase).toBe('ready');
    state.stop();
  });
  it('serializes cancelled scans and rejects obsolete results, including after close', async () => {
    vi.useFakeTimers();
    const requests: { resolve: (value: AdoptionPreview) => void; signal: AbortSignal }[] = [];
    const check = vi.fn((_source: null | string, _move: boolean, signal: AbortSignal) =>
      new Promise<AdoptionPreview>((resolve) => {
        requests.push({ resolve, signal });
      })
    );
    const state = new AdoptionDialogState(() => ['A.md'], check, () => undefined);
    state.start();
    await vi.advanceTimersByTimeAsync(400);
    state.edit('A');
    await vi.advanceTimersByTimeAsync(400);
    expect(check).toHaveBeenCalledTimes(1);
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[0]?.resolve(preview);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    expect(state.canConfirm).toBe(false);
    state.stop();
    requests[1]?.resolve(preview);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.canConfirm).toBe(false);
    state.start();
    await vi.advanceTimersByTimeAsync(400);
    requests[2]?.resolve(preview);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.canConfirm).toBe(true);
    state.stop();
  });
});
