import { EventEmitter } from 'node:events';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  buildOpenCommand,
  openVaultUri
} from './open-vault-uri.ts';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

const uri = 'obsidian://open?path=C%3A%5Cvault';

describe('Obsidian vault URI launcher', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('uses the registered Windows URI handler through a detached command shell', () => {
    expect(buildOpenCommand(uri, 'win32')).toEqual({
      args: ['/d', '/s', '/c', `start "" "${uri}"`],
      command: 'cmd.exe',
      windowsVerbatimArguments: true
    });
  });

  it('uses the platform URI opener on macOS and Linux', () => {
    expect(buildOpenCommand(uri, 'darwin')).toEqual({
      args: [uri],
      command: 'open',
      windowsVerbatimArguments: false
    });
    expect(buildOpenCommand(uri, 'linux')).toEqual({
      args: [uri],
      command: 'xdg-open',
      windowsVerbatimArguments: false
    });
  });

  it('detaches the URI handler without inheriting handles that keep the script open', async () => {
    const child = new EventEmitter() as {
      unref: ReturnType<typeof vi.fn>;
    } & EventEmitter;
    child.unref = vi.fn();
    spawnMock.mockReturnValue(child);

    const launchPromise = openVaultUri(String.raw`C:\vault`);
    child.emit('spawn');
    await launchPromise;

    const command = buildOpenCommand(uri);
    expect(spawnMock).toHaveBeenCalledWith(
      command.command,
      command.args,
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32'
      }
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('reports synchronous and asynchronous spawn failures', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('synchronous launch failure');
    });
    await expect(openVaultUri('vault')).rejects.toThrow('synchronous launch failure');

    const child = new EventEmitter();
    spawnMock.mockReturnValueOnce(child);
    const launched = openVaultUri('vault');
    child.emit('error', new Error('asynchronous launch failure'));
    await expect(launched).rejects.toThrow('asynchronous launch failure');
  });

  it.skipIf(process.platform !== 'win32')('preserves quotes through a real Windows shell without opening a URI', async () => {
    const { spawnSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const launch = buildOpenCommand(uri, 'win32');
    const command = 'echo "two words"';
    const result = spawnSync(launch.command, [...launch.args.slice(0, -1), command], {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('"two words"');
  });
});
