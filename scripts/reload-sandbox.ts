import { existsSync } from 'node:fs';

import type { ObsidianCliResult } from './obsidian-cli.ts';

import {
  formatObsidianCliResult,
  isRuntimeUnavailable,
  runObsidianCli
} from './obsidian-cli.ts';
import { openVaultUri } from './open-vault-uri.ts';
import {
  assertPrimaryCheckout,
  getCurrentSandboxPaths
} from './sandbox-paths.ts';

const CLI_TIMEOUT_MILLISECONDS = 15_000;
const RELOAD_STARTUP_TIMEOUT_MILLISECONDS = 1_000;
const RELOAD_RETRY_ATTEMPTS = 30;
const RELOAD_RETRY_DELAY_MILLISECONDS = 500;

function formatReloadError(
  result: ReturnType<typeof runReload>
): string {
  return [
    'Obsidian reload failed.',
    formatObsidianCliResult(result)
  ].join('\n');
}

function isRuntimeStarting(result: ReturnType<typeof runReload>): boolean {
  const isTimedOut = result.errorMessage.includes('ETIMEDOUT');
  return isRuntimeUnavailable(result) || isTimedOut;
}

async function main(): Promise<void> {
  assertPrimaryCheckout('Sandbox Obsidian reload');

  const sandboxVaultPath = getCurrentSandboxPaths().vaultPath;
  if (!existsSync(sandboxVaultPath)) {
    throw new Error(
      `Sandbox vault does not exist: ${sandboxVaultPath}. Run 'npm run fixtures:new-sandbox' first.`
    );
  }

  console.log(`Reloading Obsidian for sandbox vault: ${sandboxVaultPath}`);

  let result = runReload(sandboxVaultPath);
  if (isRuntimeUnavailable(result)) {
    console.log('Obsidian runtime not found; opening the sandbox vault before retrying reload.');
    await openVaultUri(sandboxVaultPath);
    result = await waitForReload(sandboxVaultPath);
  }

  if (result.errorMessage || result.status !== 0) {
    throw new Error(formatReloadError(result));
  }

  const stdout = result.stdout.trim();
  if (stdout) {
    console.log(stdout);
  }
}

function runReload(sandboxVaultPath: string): ObsidianCliResult {
  return runReloadWithTimeout(sandboxVaultPath, CLI_TIMEOUT_MILLISECONDS);
}

function runReloadWithTimeout(
  sandboxVaultPath: string,
  timeout: number
): ObsidianCliResult {
  return runObsidianCli(['reload'], sandboxVaultPath, timeout);
}

async function waitForReload(
  sandboxVaultPath: string
): Promise<ReturnType<typeof runReload>> {
  let result = runReloadWithTimeout(
    sandboxVaultPath,
    RELOAD_STARTUP_TIMEOUT_MILLISECONDS
  );
  for (let attempt = 1; attempt < RELOAD_RETRY_ATTEMPTS; attempt += 1) {
    if (!isRuntimeStarting(result)) {
      return result;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, RELOAD_RETRY_DELAY_MILLISECONDS);
    });
    result = runReloadWithTimeout(
      sandboxVaultPath,
      RELOAD_STARTUP_TIMEOUT_MILLISECONDS
    );
  }
  return result;
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
