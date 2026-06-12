import type { SpawnSyncReturns } from 'node:child_process';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { openVaultUri } from './open-vault-uri.ts';
import {
  assertPrimaryCheckout,
  getCurrentSandboxPaths
} from './sandbox-paths.ts';

const CLI_TIMEOUT_MILLISECONDS = 15_000;
const RELOAD_STARTUP_TIMEOUT_MILLISECONDS = 1_000;
const RELOAD_RETRY_ATTEMPTS = 30;
const RELOAD_RETRY_DELAY_MILLISECONDS = 500;

function formatOutput(output: null | string): string {
  const trimmedOutput = output?.trim();
  if (trimmedOutput) {
    return trimmedOutput;
  }
  return '<empty>';
}

function formatReloadError(
  cliBinary: string,
  result: ReturnType<typeof runReload>
): string {
  return [
    `Obsidian reload failed via '${cliBinary} reload'.`,
    `status: ${String(result.status)}`,
    `stdout: ${formatOutput(result.stdout)}`,
    `stderr: ${formatOutput(result.stderr)}`,
    `error: ${result.error?.message ?? '<none>'}`
  ].join('\n');
}

function isRuntimeStarting(result: ReturnType<typeof runReload>): boolean {
  const isTimedOut = result.error !== undefined
    && 'code' in result.error
    && result.error.code === 'ETIMEDOUT';
  return isRuntimeUnavailable(result) || isTimedOut;
}

function isRuntimeUnavailable(result: ReturnType<typeof runReload>): boolean {
  return [
    result.stdout,
    result.stderr,
    result.error?.message ?? ''
  ].join('\n').includes('unable to find Obsidian');
}

async function main(): Promise<void> {
  assertPrimaryCheckout('Sandbox Obsidian reload');

  const sandboxVaultPath = getCurrentSandboxPaths().vaultPath;
  if (!existsSync(sandboxVaultPath)) {
    throw new Error(
      `Sandbox vault does not exist: ${sandboxVaultPath}. Run 'npm run fixtures:new-sandbox' first.`
    );
  }

  const configuredCliBinary = process.env['OBSIDIAN_CLI_BIN']?.trim();
  let cliBinary = 'obsidian';
  if (configuredCliBinary) {
    cliBinary = configuredCliBinary;
  }
  console.log(`Reloading Obsidian for sandbox vault: ${sandboxVaultPath}`);

  let result = runReload(cliBinary, sandboxVaultPath);
  if (isRuntimeUnavailable(result)) {
    console.log('Obsidian runtime not found; opening the sandbox vault before retrying reload.');
    await openVaultUri(sandboxVaultPath);
    result = await waitForReload(cliBinary, sandboxVaultPath);
  }

  if (result.error || result.status !== 0) {
    throw new Error(formatReloadError(cliBinary, result));
  }

  const stdout = result.stdout.trim();
  if (stdout) {
    console.log(stdout);
  }
}

function runReload(cliBinary: string, sandboxVaultPath: string): SpawnSyncReturns<string> {
  return runReloadWithTimeout(cliBinary, sandboxVaultPath, CLI_TIMEOUT_MILLISECONDS);
}

function runReloadWithTimeout(
  cliBinary: string,
  sandboxVaultPath: string,
  timeout: number
): SpawnSyncReturns<string> {
  return spawnSync(cliBinary, ['reload'], {
    cwd: sandboxVaultPath,
    encoding: 'utf8',
    timeout
  });
}

async function waitForReload(
  cliBinary: string,
  sandboxVaultPath: string
): Promise<ReturnType<typeof runReload>> {
  let result = runReloadWithTimeout(
    cliBinary,
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
      cliBinary,
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
