import {
  access,
  cp,
  mkdir,
  readdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

const FIXTURE_VAULT_RELATIVE_PATH = 'test/fixtures/fixture/vault';
const FIXTURE_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/fixture/external-root';
const SANDBOX_VAULT_RELATIVE_PATH = 'test/fixtures/sandbox/vault';
const SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/sandbox/external-root';

const JSON_INDENT = 2;

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
    await rm(path.join(directoryPath, entry.name), { force: true, recursive: true });
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
  await rm(destinationPath, { force: true, recursive: true });
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true, recursive: true });
}

function getAbsolutePath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-magic-numbers -- standard argv offset
  const mode = parseMode(process.argv.slice(2));
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

async function syncSandbox(mode: SyncMode): Promise<void> {
  const fixtureVaultPath = getAbsolutePath(FIXTURE_VAULT_RELATIVE_PATH);
  const fixtureExternalRootPath = getAbsolutePath(FIXTURE_EXTERNAL_ROOT_RELATIVE_PATH);
  const sandboxVaultPath = getAbsolutePath(SANDBOX_VAULT_RELATIVE_PATH);
  const sandboxExternalRootPath = getAbsolutePath(SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH);

  if (mode === 'print-paths') {
    console.log(JSON.stringify(
      {
        fixtureExternalRootPath,
        fixtureVaultPath,
        sandboxExternalRootPath,
        sandboxVaultPath
      },
      null,
      JSON_INDENT
    ));
    return;
  }

  await assertExists(fixtureVaultPath, 'fixture vault');
  await assertExists(fixtureExternalRootPath, 'fixture external root');

  if (mode === 'full') {
    await fullReplaceDirectory(fixtureVaultPath, sandboxVaultPath);
  } else {
    // eslint-disable-next-line obsidianmd/hardcoded-config-path -- filesystem path, not runtime Vault access
    await clearDirectoryChildren(sandboxVaultPath, new Set(['.obsidian']));
    // eslint-disable-next-line obsidianmd/hardcoded-config-path -- filesystem path, not runtime Vault access
    await copyDirectoryChildren(fixtureVaultPath, sandboxVaultPath, new Set(['.obsidian']));
  }

  if (mode === 'full') {
    await fullReplaceDirectory(fixtureExternalRootPath, sandboxExternalRootPath);
  } else {
    await clearDirectoryChildren(sandboxExternalRootPath);
    await copyDirectoryChildren(fixtureExternalRootPath, sandboxExternalRootPath);
  }

  console.log(`Fixture sync complete (${mode}).`);
  console.log(`Vault: ${fixtureVaultPath} -> ${sandboxVaultPath}`);
  console.log(`External root: ${fixtureExternalRootPath} -> ${sandboxExternalRootPath}`);
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
