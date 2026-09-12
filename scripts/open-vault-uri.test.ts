import { EventEmitter } from 'node:events';
import {
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
  it('uses the registered Windows URI handler through a detached command shell', () => {
    expect(buildOpenCommand(uri, 'win32')).toEqual({
      args: ['/d', '/s', '/c', `start "" "${uri}"`],
      command: 'cmd.exe'
    });
  });

  it('uses the platform URI opener on macOS and Linux', () => {
    expect(buildOpenCommand(uri, 'darwin')).toEqual({
      args: [uri],
      command: 'open'
    });
    expect(buildOpenCommand(uri, 'linux')).toEqual({
      args: [uri],
      command: 'xdg-open'
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

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/s', '/c', `start "" "${uri}"`],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
