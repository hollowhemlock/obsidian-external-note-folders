import {
  access,
  cp,
  mkdir,
  readdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';

import {
  assertPrimaryCheckout,
  getCurrentSandboxPaths,
  resolveProjectPath,
  SANDBOX_REPORTS_RELATIVE_PATH
} from './sandbox-paths.ts';

const FIXTURE_VAULT_RELATIVE_PATH = 'test/fixtures/fixture/vault-plugin-external-note-folders-fixture';
const FIXTURE_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/fixture/external-root';

const JSON_INDENT = 2;
const REMOVE_MAX_RETRIES = 10;
const REMOVE_RETRY_DELAY_MS = 100;

type SyncMode = 'content-only' | 'full' | 'print-paths';

async function assertExists(targetPath: string, label: string): Promise<void> {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

async function clearDirectoryChildren(
  directoryPath: string,
  entriesToPreserve = new Set<string>()
): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entriesToPreserve.has(entry.name)) {
      continue;
    }
    await removePath(path.join(directoryPath, entry.name));
  }
}

async function copyDirectoryChildren(
  sourcePath: string,
  destinationPath: string,
  entriesToSkip = new Set<string>()
): Promise<void> {
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entriesToSkip.has(entry.name)) {
      continue;
    }
    await cp(
      path.join(sourcePath, entry.name),
      path.join(destinationPath, entry.name),
      { force: true, recursive: true }
    );
  }
}

async function fullReplaceDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  await removePath(destinationPath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true, recursive: true });
}

function getAbsolutePath(relativePath: string): string {
  return resolveProjectPath(relativePath);
}

function isBusyRemoveError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (
      error.code === 'EBUSY'
      || error.code === 'ENOTEMPTY'
      || error.code === 'EPERM'
    );
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  assertPrimaryCheckout('Sandbox fixture access');
  await syncSandbox(mode);
}

function parseMode(argv: readonly string[]): SyncMode {
  if (argv.includes('--print-paths')) {
    return 'print-paths';
  }
  if (argv.includes('--content-only')) {
    return 'content-only';
  }
  return 'full';
}

async function removePath(targetPath: string): Promise<void> {
  try {
    await rm(targetPath, {
      force: true,
      maxRetries: REMOVE_MAX_RETRIES,
      recursive: true,
      retryDelay: REMOVE_RETRY_DELAY_MS
    });
  } catch (error: unknown) {
    if (process.platform === 'win32' && isBusyRemoveError(error)) {
      throw new Error(
        `Could not remove sandbox path because Windows still has it locked after ${
          String(REMOVE_MAX_RETRIES)
        } retries: ${targetPath}. Close Obsidian and any other process using this path, then run the command again.`,
        { cause: error }
      );
    }
    throw error;
  }
}

async function syncSandbox(mode: SyncMode): Promise<void> {
  const fixtureVaultPath = getAbsolutePath(FIXTURE_VAULT_RELATIVE_PATH);
  const fixtureExternalRootPath = getAbsolutePath(FIXTURE_EXTERNAL_ROOT_RELATIVE_PATH);
  const sandboxPaths = getCurrentSandboxPaths();

  if (mode === 'print-paths') {
    console.log(JSON.stringify(
      {
        fixtureExternalRootPath,
        fixtureVaultPath,
        sandboxExternalRootPath: sandboxPaths.externalRootPath,
        sandboxVaultPath: sandboxPaths.vaultPath
      },
      null,
      JSON_INDENT
    ));
    return;
  }

  await assertExists(fixtureVaultPath, 'fixture vault');
  await assertExists(fixtureExternalRootPath, 'fixture external root');

  const sandboxReportsPath = resolveProjectPath(SANDBOX_REPORTS_RELATIVE_PATH);
  if (mode === 'full') {
    await fullReplaceDirectory(fixtureVaultPath, sandboxPaths.vaultPath);
  } else {
    await clearDirectoryChildren(sandboxPaths.vaultPath, new Set(['.obsidian']));
    await copyDirectoryChildren(fixtureVaultPath, sandboxPaths.vaultPath, new Set(['.obsidian']));
  }

  if (mode === 'full') {
    await fullReplaceDirectory(fixtureExternalRootPath, sandboxPaths.externalRootPath);
  } else {
    await clearDirectoryChildren(sandboxPaths.externalRootPath);
    await copyDirectoryChildren(fixtureExternalRootPath, sandboxPaths.externalRootPath);
  }
  await removePath(sandboxReportsPath);

  console.log(`Fixture sync complete (${mode}).`);
  console.log(`Vault: ${fixtureVaultPath} -> ${sandboxPaths.vaultPath}`);
  console.log(`External root: ${fixtureExternalRootPath} -> ${sandboxPaths.externalRootPath}`);
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
