import path from 'node:path';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { GitStatusIgnore } from './gitStatusIgnore.ts';

const { run, spawn } = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => {
  const { promisify } = await import('node:util');
  return { ...await original<typeof import('node:child_process')>(), execFile: Object.assign(vi.fn(), { [promisify.custom]: run }), spawn };
});
vi.mock('node:fs/promises', () => ({ lstat: vi.fn(async () => ({ isDirectory: (): boolean => true })) }));
beforeEach(() => {
  vi.clearAllMocks();
  run.mockReset();
  run.mockResolvedValue({ stderr: '', stdout: '' });
});

describe('repository validation failures', () => {
  it.each(['repository', 'index'])('classifies a normal %s validation exit and preserves its diagnostic', async (stage) => {
    if (stage === 'index') {
      run.mockResolvedValueOnce({ stderr: '', stdout: '' });
    }
    run.mockRejectedValueOnce(Object.assign(new Error('localized diagnostic'), { code: 128, killed: false, signal: null }));
    const result = new GitStatusIgnore().context(path.resolve('broken'), null);
    await expect(result).rejects.toSatisfy((error: Error) => error.constructor.name === 'GitRepositoryValidationError');
    await expect(result).rejects.toMatchObject({ command: { code: 128, diagnostic: 'localized diagnostic', killed: false, signal: null, stage } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'ENOENT' },
    { code: 'EACCES' },
    { code: null, killed: true, signal: 'SIGTERM' },
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
    { code: 128, killed: true, signal: null },
    { code: 128, killed: false, signal: 'SIGTERM' }
  ])('keeps process failure %j fatal', async (details) => {
    run.mockRejectedValueOnce(Object.assign(new Error('process failed'), details));
    await expect(new GitStatusIgnore().context(path.resolve('broken'), null)).rejects.toSatisfy((error: Error) =>
      error.constructor.name === 'GitFilteringError'
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps successful commands with stderr fatal', async () => {
    run.mockResolvedValueOnce({ stderr: 'unexpected warning', stdout: '' });
    await expect(new GitStatusIgnore().context(path.resolve('broken'), null)).rejects.toSatisfy((error: Error) =>
      error.constructor.name === 'GitFilteringError'
    );
  });

  it('preserves cancellation instead of classifying it as a validation failure', async () => {
    const controller = new AbortController();
    run.mockImplementationOnce(async () => {
      controller.abort();
      throw Object.assign(new Error('cancelled'), { code: 128 });
    });
    await expect(new GitStatusIgnore(controller.signal).context(path.resolve('broken'), null)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
