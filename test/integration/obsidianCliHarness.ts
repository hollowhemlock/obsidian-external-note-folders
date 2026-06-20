import {
  access,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';
import { expect } from 'vitest';

import type { ObsidianCliResult as CliResult } from '../../scripts/obsidian-cli.ts';

import {
  formatObsidianCliResult,
  runObsidianCli
} from '../../scripts/obsidian-cli.ts';
import { buildExnfMarkerFileName } from '../../src/core/marker.ts';
export { writeSandboxReport } from '../support/integration/reportCapture.ts';

export type { ObsidianCliResult as CliResult } from '../../scripts/obsidian-cli.ts';

interface Manifest {
  id: string;
}

const CLI_TIMEOUT_MILLISECONDS = 3_000;
const COMMAND_REGISTRATION_ATTEMPTS = 5;
const COMMAND_REGISTRATION_RETRY_DELAY_MILLISECONDS = 500;
const MODAL_TEXT_ATTEMPTS = 20;
const MODAL_TEXT_RETRY_DELAY_MILLISECONDS = 500;
export async function assertSandboxPluginInstalled(pluginId: string): Promise<void> {
  await access(path.join(
    getSandboxVaultPath(),
    '.obsidian',
    'plugins',
    pluginId,
    'manifest.json'
  ));
}

export function assertCliAvailable(result: CliResult): boolean {
  expect(result.status, formatCliResult(result)).toBe(0);
  return true;
}

export async function createCliNote(notePath: string, uuid: string): Promise<void> {
  const createResult = runSandboxCli([
    'create',
    `path=${notePath}`,
    `content=---\nexnf: ${uuid}\n---\n\nCLI drift matrix note.`,
    'overwrite'
  ]);
  expect(createResult.status, formatCliResult(createResult)).toBe(0);
}

export function formatCliResult(result: CliResult): string {
  return formatObsidianCliResult(result);
}

export function getSandboxVaultPath(): string {
  return resolveRepoPath('test/fixtures/sandbox/plugin-external-note-folders-sandbox');
}

export async function readSandboxPluginId(): Promise<string> {
  const manifest = JSON.parse(await readFile(resolveRepoPath('manifest.json'), 'utf8')) as unknown;
  if (!isManifest(manifest)) {
    throw new Error('manifest.json does not contain a plugin id.');
  }

  return manifest.id;
}

export function resolveRepoPath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

export function runCli(args: readonly string[], vaultPath: string): CliResult {
  return runObsidianCli(args, vaultPath, CLI_TIMEOUT_MILLISECONDS);
}

export function runSandboxCli(args: readonly string[]): CliResult {
  return runCli(args, getSandboxVaultPath());
}

export async function waitForPluginCommands(pluginId: string, vaultPath = getSandboxVaultPath()): Promise<CliResult> {
  let latestResult = runCli(['commands'], vaultPath);

  for (let attempt = 1; attempt < COMMAND_REGISTRATION_ATTEMPTS; attempt += 1) {
    if (latestResult.stdout.includes(`${pluginId}:`)) {
      return latestResult;
    }

    await delay(COMMAND_REGISTRATION_RETRY_DELAY_MILLISECONDS);
    latestResult = runCli(['commands'], vaultPath);
  }

  return latestResult;
}

export async function waitForSandboxModalText(containsText: string): Promise<CliResult> {
  let latestResult = runSandboxCli(['dev:dom', 'selector=.modal', 'text']);

  for (let attempt = 1; attempt < MODAL_TEXT_ATTEMPTS; attempt += 1) {
    if (latestResult.status === 0 && latestResult.stdout.includes(containsText)) {
      return latestResult;
    }

    await delay(MODAL_TEXT_RETRY_DELAY_MILLISECONDS);
    latestResult = runSandboxCli(['dev:dom', 'selector=.modal', 'text']);
  }

  return latestResult;
}

export async function writeMarker(externalFolderRelativePath: string, uuid: string, markerContent = `${uuid}\n`): Promise<void> {
  const externalRootPath = resolveRepoPath('test/fixtures/sandbox/external-root');
  const folderPath = path.join(externalRootPath, externalFolderRelativePath);
  await mkdir(folderPath, { recursive: true });
  await writeFile(path.join(folderPath, buildExnfMarkerFileName(uuid)), markerContent, 'utf8');
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isManifest(input: unknown): input is Manifest {
  return typeof input === 'object'
    && input !== null
    && 'id' in input
    && typeof input.id === 'string';
}
