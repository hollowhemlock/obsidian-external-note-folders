import type { ChildProcess } from 'node:child_process';

import { spawn } from 'node:child_process';

interface OpenCommand {
  args: string[];
  command: string;
}

export function buildOpenCommand(
  uri: string,
  platform: NodeJS.Platform = process.platform
): OpenCommand {
  if (platform === 'win32') {
    return {
      args: ['/d', '/s', '/c', `start "" "${uri}"`],
      command: 'cmd.exe'
    };
  }
  if (platform === 'darwin') {
    return {
      args: [uri],
      command: 'open'
    };
  }
  return {
    args: [uri],
    command: 'xdg-open'
  };
}

export async function openVaultUri(vaultPath: string): Promise<void> {
  const uri = `obsidian://open?path=${encodeURIComponent(vaultPath)}`;
  const launch = buildOpenCommand(uri);
  await launchDetached(launch.command, launch.args);
}

function launchDetached(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
