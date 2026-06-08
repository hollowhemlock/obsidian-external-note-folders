import {
  access,
  cp,
  mkdir,
  readdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';

import {
  getCurrentSandboxPaths,
  getExistingLinkedWorktreeSandboxPaths,
  getLinkedWorktreeSandboxPaths,
  resolveProjectPath,
  SANDBOX_REPORTS_RELATIVE_PATH
} from './sandbox-paths.ts';

const FIXTURE_VAULT_RELATIVE_PATH = 'test/fixtures/fixture/vault';
const FIXTURE_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/fixture/external-root';

const JSON_INDENT = 2;
const REMOVE_MAX_RETRIES = 10;
const REMOVE_RETRY_DELAY_MS = 100;

type SyncMode = 'content-only' | 'full' | 'print-paths';

interface SyncOptions {
  mode: SyncMode;
  scope: SyncScope;
}

type SyncScope = 'all-worktrees' | 'current';

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
  const options = parseOptions(process.argv.slice(2));
  await syncSandbox(options);
}

function parseOptions(argv: readonly string[]): SyncOptions {
  const scope = argv.includes('--all-worktrees') ? 'all-worktrees' : 'current';
  if (argv.includes('--print-paths')) {
    return {
      mode: 'print-paths',
      scope
    };
  }
  if (argv.includes('--content-only')) {
    return {
      mode: 'content-only',
      scope
    };
  }
  return {
    mode: 'full',
    scope
  };
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
        `Could not remove sandbox path because Windows still has it locked after ${String(REMOVE_MAX_RETRIES)} retries: ${targetPath}`,
        { cause: error }
      );
    }
    throw error;
  }
}

async function syncSandbox(options: SyncOptions): Promise<void> {
  const fixtureVaultPath = getAbsolutePath(FIXTURE_VAULT_RELATIVE_PATH);
  const fixtureExternalRootPath = getAbsolutePath(FIXTURE_EXTERNAL_ROOT_RELATIVE_PATH);
  const currentSandboxPaths = getCurrentSandboxPaths();
  const syncTargets = options.scope === 'all-worktrees'
    ? [currentSandboxPaths, ...getLinkedWorktreeSandboxPaths()]
    : [currentSandboxPaths];

  if (options.mode === 'print-paths') {
    console.log(JSON.stringify(
      {
        fixtureExternalRootPath,
        fixtureVaultPath,
        linkedWorktreeSandboxes: getExistingLinkedWorktreeSandboxPaths().map((sandboxPaths) => ({
          sandboxExternalRootPath: sandboxPaths.externalRootPath,
          sandboxVaultPath: sandboxPaths.vaultPath,
          worktreePath: sandboxPaths.worktreePath
        })),
        sandboxExternalRootPath: currentSandboxPaths.externalRootPath,
        sandboxVaultPath: currentSandboxPaths.vaultPath
      },
      null,
      JSON_INDENT
    ));
    return;
  }

  await assertExists(fixtureVaultPath, 'fixture vault');
  await assertExists(fixtureExternalRootPath, 'fixture external root');

  for (const sandboxPaths of syncTargets) {
    const sandboxReportsPath = path.join(sandboxPaths.worktreePath, SANDBOX_REPORTS_RELATIVE_PATH);
    if (options.mode === 'full') {
      await fullReplaceDirectory(fixtureVaultPath, sandboxPaths.vaultPath);
    } else {
      await clearDirectoryChildren(sandboxPaths.vaultPath, new Set(['.obsidian']));
      await copyDirectoryChildren(fixtureVaultPath, sandboxPaths.vaultPath, new Set(['.obsidian']));
    }

    if (options.mode === 'full') {
      await fullReplaceDirectory(fixtureExternalRootPath, sandboxPaths.externalRootPath);
    } else {
      await clearDirectoryChildren(sandboxPaths.externalRootPath);
      await copyDirectoryChildren(fixtureExternalRootPath, sandboxPaths.externalRootPath);
    }
    await removePath(sandboxReportsPath);

    console.log(`Fixture sync complete (${options.mode}, ${sandboxPaths.source}).`);
    console.log(`Vault: ${fixtureVaultPath} -> ${sandboxPaths.vaultPath}`);
    console.log(`External root: ${fixtureExternalRootPath} -> ${sandboxPaths.externalRootPath}`);
  }
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
