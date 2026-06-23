import { access } from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

import { openVaultUri } from './open-vault-uri.ts';
import { assertPrimaryCheckout } from './sandbox-paths.ts';

const FIXTURE_VAULT_RELATIVE_PATH = 'test/fixtures/fixture/vault-plugin-external-note-folders-fixture';
const SANDBOX_VAULT_RELATIVE_PATH = 'test/fixtures/sandbox/vault-plugin-external-note-folders-sandbox';

type VaultTarget = 'fixture' | 'sandbox';

async function assertDirectoryExists(targetPath: string): Promise<void> {
  await access(targetPath);
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === '--help' || input === '-h') {
    printUsage();
    return;
  }

  assertPrimaryCheckout('Obsidian vault opening');

  const vaultPath = resolveVaultPath(input as undefined | VaultTarget);
  await assertDirectoryExists(vaultPath);

  console.log(`Opening vault: ${vaultPath}`);
  await openVaultUri(vaultPath);
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
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
