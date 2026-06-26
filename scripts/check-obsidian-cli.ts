import {
  existsSync,
  readFileSync,
  rmSync
} from 'node:fs';
import path from 'node:path';

import {
  assertSupportedObsidianVersion,
  formatObsidianCliResult,
  isRuntimeUnavailable,
  MINIMUM_OBSIDIAN_VERSION,
  runObsidianCli
} from './obsidian-cli.ts';
import {
  assertPrimaryCheckout,
  getCurrentSandboxPaths,
  isSamePath,
  resolveProjectPath
} from './sandbox-paths.ts';

const CLI_TIMEOUT_MILLISECONDS = 15_000;
const ACTIVE_VAULT_PROBE_RELATIVE_PATH = '.exnf-active-vault-probe.json';
const ACTIVE_VAULT_PROBE_ATTEMPTS = 20;
const ACTIVE_VAULT_PROBE_DELAY_MILLISECONDS = 250;

interface ActiveVaultProbe {
  basePath: string;
}

function buildActiveVaultProbeScript(): string {
  return [
    '(async () => {',
    `  const outputPath = ${JSON.stringify(ACTIVE_VAULT_PROBE_RELATIVE_PATH)};`,
    '  const adapter = app.vault.adapter;',
    '  const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : (adapter.basePath ?? "");',
    '  await adapter.write(outputPath, JSON.stringify({ basePath }));',
    '})()'
  ].join('\n');
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isActiveVaultProbe(input: unknown): input is ActiveVaultProbe {
  return typeof input === 'object'
    && input !== null
    && 'basePath' in input
    && typeof input.basePath === 'string'
    && input.basePath.length > 0;
}

async function main(): Promise<void> {
  assertPrimaryCheckout('Obsidian CLI integration');

  const version = assertSupportedObsidianVersion(
    runObsidianCli(['version'], resolveProjectPath('.'), CLI_TIMEOUT_MILLISECONDS)
  );
  console.log(`Obsidian CLI preflight passed: ${version.text} (minimum ${MINIMUM_OBSIDIAN_VERSION}).`);

  const sandboxVaultPath = getCurrentSandboxPaths().vaultPath;
  const activeVaultPath = await readActiveVaultBasePath(sandboxVaultPath);
  if (!isSamePath(activeVaultPath, sandboxVaultPath)) {
    throw new Error([
      'Obsidian is serving the wrong vault.',
      `Active vault:  ${activeVaultPath}`,
      `Sandbox vault: ${sandboxVaultPath}`,
      'Open the sandbox vault (npm run vault:open) before running integration tests.'
    ].join('\n'));
  }

  console.log(`Obsidian runtime is serving the sandbox vault: ${activeVaultPath}`);
}

async function readActiveVaultBasePath(sandboxVaultPath: string): Promise<string> {
  const probeAbsolutePath = path.join(sandboxVaultPath, ACTIVE_VAULT_PROBE_RELATIVE_PATH);
  rmSync(probeAbsolutePath, { force: true });

  const result = runObsidianCli(
    ['eval', `code=${buildActiveVaultProbeScript()}`],
    sandboxVaultPath,
    CLI_TIMEOUT_MILLISECONDS
  );

  if (isRuntimeUnavailable(result)) {
    throw new Error([
      'Obsidian runtime is not available.',
      'Open the sandbox vault (npm run vault:open) and ensure the CLI is connected before running integration tests.',
      formatObsidianCliResult(result)
    ].join('\n'));
  }

  if (result.status !== 0) {
    throw new Error([
      'Obsidian CLI could not query the active vault.',
      formatObsidianCliResult(result)
    ].join('\n'));
  }

  for (let attempt = 0; attempt < ACTIVE_VAULT_PROBE_ATTEMPTS; attempt += 1) {
    const probe = tryReadActiveVaultProbe(probeAbsolutePath);
    if (probe) {
      rmSync(probeAbsolutePath, { force: true });
      return probe.basePath;
    }

    await delay(ACTIVE_VAULT_PROBE_DELAY_MILLISECONDS);
  }

  throw new Error([
    'Could not confirm the active Obsidian vault.',
    `Expected the sandbox vault to be open: ${sandboxVaultPath}`,
    'Open the sandbox vault (npm run vault:open) before running integration tests.'
  ].join('\n'));
}

function tryReadActiveVaultProbe(probeAbsolutePath: string): ActiveVaultProbe | null {
  if (!existsSync(probeAbsolutePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(probeAbsolutePath, 'utf8')) as unknown;
    if (isActiveVaultProbe(parsed)) {
      return parsed;
    }
  } catch {
    // The runtime may still be writing the probe file; retry on the next attempt.
  }

  return null;
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
