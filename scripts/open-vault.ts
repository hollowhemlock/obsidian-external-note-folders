import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

const execAsync = promisify(exec);

const FIXTURE_VAULT_RELATIVE_PATH = 'test/fixtures/fixture/vault';
const SANDBOX_VAULT_RELATIVE_PATH = 'test/fixtures/sandbox/vault';

type VaultTarget = 'fixture' | 'sandbox';

async function assertDirectoryExists(targetPath: string): Promise<void> {
  await access(targetPath);
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

async function main(): Promise<void> {
  // eslint-disable-next-line no-magic-numbers -- standard argv offset
  const input = process.argv[2];
  if (input === '--help' || input === '-h') {
    printUsage();
    return;
  }

  const vaultPath = resolveVaultPath(input as undefined | VaultTarget);
  await assertDirectoryExists(vaultPath);

  const uri = `obsidian://open?path=${encodeURIComponent(vaultPath)}`;
  const command = buildOpenCommand(uri);

  console.log(`Opening vault: ${vaultPath}`);
  await execAsync(command);
}

function printUsage(): void {
  console.log('Usage: jiti scripts/open-vault.ts [sandbox|fixture|relative-or-absolute-vault-path]');
}

function resolvePath(relativeOrAbsolutePath: string): string {
  return resolvePathFromRoot(relativeOrAbsolutePath) ?? path.resolve(process.cwd(), relativeOrAbsolutePath);
}

function resolveVaultPath(input?: string): string {
  if (!input || input === 'sandbox') {
    return resolvePath(SANDBOX_VAULT_RELATIVE_PATH);
  }
  if (input === 'fixture') {
    return resolvePath(FIXTURE_VAULT_RELATIVE_PATH);
  }
  return resolvePath(input);
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error('Failed to open vault:', error);
  process.exit(1);
});
