import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function openVaultUri(vaultPath: string): Promise<void> {
  const uri = `obsidian://open?path=${encodeURIComponent(vaultPath)}`;
  await execAsync(buildOpenCommand(uri));
}

function buildOpenCommand(uri: string): string {
  if (process.platform === 'win32') {
    return `start "" "${uri}"`;
  }
  if (process.platform === 'darwin') {
    return `open "${uri}"`;
  }
  return `xdg-open "${uri}"`;
}
