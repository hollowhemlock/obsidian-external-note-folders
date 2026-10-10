import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { GitIgnoreRepository } from './gitStatusIgnore.ts';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn }));

class Child extends EventEmitter {
  public kill = vi.fn(() => {
    this.emit('close', null);
    return true;
  });

  public stderr = new PassThrough();
  public stdin = new PassThrough();
  public stdout = new PassThrough();
}
let child: Child;
let repository: GitIgnoreRepository;
const root = path.resolve('repository');
beforeEach(() => {
  child = new Child();
  spawn.mockReturnValue(child);
  repository = new GitIgnoreRepository(root, []);
});
afterEach(() => {
  repository.dispose();
  vi.useRealTimers();
});

describe('Git ignore process protocol', () => {
  it('parses split UTF-8 records and negation without launching a process per directory', async () => {
    const ignored = repository.ignores(path.join(root, 'café'));
    const record = Buffer.from(['.gitignore', '1', 'café/', 'café', ''].join('\0'));
    const split = record.indexOf(Buffer.from('é')) + 1;
    child.stdout.write(record.subarray(0, split));
    child.stdout.write(record.subarray(split));
    await expect(ignored).resolves.toContain('café/');
    const included = repository.ignores(path.join(root, 'included'));
    child.stdout.write(['.gitignore', '2', '!included/', 'included', ''].join('\0'));
    await expect(included).resolves.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('accepts a no-match response and normal no-match exit', async () => {
    const result = repository.ignores(path.join(root, 'included'));
    child.stdout.write('\0\0\0included\0');
    await expect(result).resolves.toBeNull();
    const finished = repository.finish();
    child.emit('close', 1);
    await expect(finished).resolves.toBeUndefined();
  });

  it.each(['stderr', 'malformed', 'exit', 'timeout'])('rejects %s and terminates the child', async (failure) => {
    vi.useFakeTimers();
    const result = repository.ignores(path.join(root, 'folder'));
    const rejected = expect(result).rejects.toThrow('Git filtering failed');
    if (failure === 'stderr') {
      child.stderr.write('Cannot read ignore file');
    }
    if (failure === 'malformed') {
      child.stdout.write('\0\0\0wrong-path\0');
    }
    if (failure === 'exit') {
      child.emit('close', 128);
    }
    if (failure === 'timeout') {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    await rejected;
    expect(child.kill).toHaveBeenCalled();
  });

  it('aborts an incomplete response and cleans up the child', async () => {
    repository.dispose();
    const controller = new AbortController();
    child = new Child();
    spawn.mockReturnValue(child);
    repository = new GitIgnoreRepository(root, [], controller.signal);
    const result = repository.ignores(path.join(root, 'folder'));
    const rejected = expect(result).rejects.toThrow();
    child.stdout.write('.gitignore\0');
    controller.abort();
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
