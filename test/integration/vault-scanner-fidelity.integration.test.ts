import {
  readFile,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import type {
  ScanIssue,
  VaultScanResult
} from '../../src/core/verify.ts';

import { scanFixtureVault } from '../support/fixtures/vaultFixtureScanner.ts';
import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  formatCliResult,
  getSandboxVaultPath,
  readSandboxPluginId,
  runCli,
  waitForPluginCommands
} from './obsidianCliHarness.ts';

const DRIFT_SCENARIO_PATH = 'drift-report/basic-drift-matrix';

interface SerializedVaultScan {
  bindings: [string, string][];
  duplicatePaths: [string, string[]][];
  invalidFrontmatter: ScanIssue[];
}

describe('vault scanner fidelity integration', () => {
  const sandboxVaultPath = getSandboxVaultPath();
  let pluginId = '';

  beforeAll(async () => {
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
  });

  it('keeps the fixture vault scanner aligned with the production Obsidian scan', async () => {
    const commandsResult = await waitForPluginCommands(pluginId, sandboxVaultPath);
    assertCliAvailable(commandsResult);

    const runtimeScan = filterSerializedVaultScan(
      await readRuntimeVaultScan(pluginId, sandboxVaultPath),
      DRIFT_SCENARIO_PATH
    );
    const fixtureScan = serializeVaultScan(
      await scanFixtureVault({
        relativeScenarioPath: DRIFT_SCENARIO_PATH,
        vaultRootPath: sandboxVaultPath
      })
    );

    expect(runtimeScan).toEqual(fixtureScan);
  });
});

async function readRuntimeVaultScan(pluginId: string, sandboxVaultPath: string): Promise<SerializedVaultScan> {
  const outputVaultPath = getRuntimeScanOutputPath(pluginId);
  const errorVaultPath = `${outputVaultPath}.error`;
  const outputPath = path.join(sandboxVaultPath, ...outputVaultPath.split('/'));
  const errorPath = path.join(sandboxVaultPath, ...errorVaultPath.split('/'));
  await rm(outputPath, { force: true });
  await rm(errorPath, { force: true });

  const evalResult = runCli([
    'eval',
    `code=${buildRuntimeVaultScanScript(pluginId, outputVaultPath, errorVaultPath)}`
  ], sandboxVaultPath);
  expect(evalResult.status, formatCliResult(evalResult)).toBe(0);

  const parsed = JSON.parse(await readRuntimeVaultScanOutput(outputPath, errorPath)) as unknown;
  if (!isSerializedVaultScan(parsed)) {
    throw new Error('Runtime vault scan output did not match the expected serialized shape.');
  }

  return parsed;
}

function getRuntimeScanOutputPath(pluginId: string): string {
  return `.obsidian/plugins/${pluginId}/scanner-fidelity-vault-scan.json`;
}

function buildRuntimeVaultScanScript(pluginId: string, outputPath: string, errorPath: string): string {
  return [
    '(async () => {',
    '  try {',
    `    const pluginId = ${JSON.stringify(pluginId)};`,
    `    const outputPath = ${JSON.stringify(outputPath)};`,
    `    const errorPath = ${JSON.stringify(errorPath)};`,
    '    const plugin = app.plugins.getPlugin?.(pluginId) ?? app.plugins.plugins[pluginId];',
    '    if (!plugin || typeof plugin.collectScanContext !== "function") {',
    '      throw new Error(`Plugin ${pluginId} does not expose collectScanContext at runtime.`);',
    '    }',
    '    const context = await plugin.collectScanContext();',
    '    const vaultScan = context.vaultScan;',
    '    const output = {',
    '      bindings: Array.from(vaultScan.bindings.entries()).sort(([left], [right]) => left.localeCompare(right)),',
    '      duplicatePaths: Array.from(vaultScan.duplicatePaths.entries())',
    '        .map(([uuid, paths]) => [uuid, [...paths].sort()])',
    '        .sort(([left], [right]) => left.localeCompare(right)),',
    '      invalidFrontmatter: [...vaultScan.invalidFrontmatter]',
    '        .sort((left, right) => left.location.localeCompare(right.location))',
    '    };',
    '    await app.vault.adapter.write(outputPath, JSON.stringify(output, null, 2));',
    '  } catch (error) {',
    '    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);',
    '    await app.vault.adapter.write(errorPath, message);',
    '  }',
    '})()'
  ].join('\n');
}

async function readRuntimeVaultScanOutput(outputPath: string, errorPath: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const errorOutput = await tryReadFile(errorPath);
    if (errorOutput !== null) {
      throw new Error(`Runtime vault scan failed inside Obsidian:\n${errorOutput}`);
    }

    const output = await tryReadFile(outputPath);
    if (output !== null) {
      return output;
    }

    await delay(250);
  }

  throw new Error('Timed out waiting for runtime vault scan output from Obsidian.');
}

function filterSerializedVaultScan(scan: SerializedVaultScan, scenarioPath: string): SerializedVaultScan {
  return {
    bindings: sortBindingEntries(scan.bindings.filter(([, notePath]) => isInScenario(notePath, scenarioPath))),
    duplicatePaths: sortDuplicateEntries(
      scan.duplicatePaths
        .map(([uuid, notePaths]) => [uuid, notePaths.filter((notePath) => isInScenario(notePath, scenarioPath)).sort()] as [string, string[]])
        .filter(([, notePaths]) => notePaths.length > 1)
    ),
    invalidFrontmatter: sortIssues(scan.invalidFrontmatter.filter((issue) => isInScenario(issue.location, scenarioPath)))
  };
}

function isInScenario(notePath: string, scenarioPath: string): boolean {
  return notePath === scenarioPath || notePath.startsWith(`${scenarioPath}/`);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function tryReadFile(filePath: string): Promise<null | string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function isSerializedVaultScan(input: unknown): input is SerializedVaultScan {
  return typeof input === 'object'
    && input !== null
    && 'bindings' in input
    && isStringPairArray(input.bindings)
    && 'duplicatePaths' in input
    && isDuplicatePathArray(input.duplicatePaths)
    && 'invalidFrontmatter' in input
    && Array.isArray(input.invalidFrontmatter)
    && input.invalidFrontmatter.every(isScanIssue);
}

function isDuplicatePathArray(input: unknown): input is [string, string[]][] {
  return Array.isArray(input)
    && input.every((item) =>
      Array.isArray(item)
      && item.length === 2
      && typeof item[0] === 'string'
      && Array.isArray(item[1])
      && item[1].every((pathValue) => typeof pathValue === 'string')
    );
}

function isScanIssue(input: unknown): input is ScanIssue {
  return typeof input === 'object'
    && input !== null
    && 'location' in input
    && typeof input.location === 'string'
    && 'message' in input
    && typeof input.message === 'string';
}

function isStringPairArray(input: unknown): input is [string, string][] {
  return Array.isArray(input)
    && input.every((item) =>
      Array.isArray(item)
      && item.length === 2
      && typeof item[0] === 'string'
      && typeof item[1] === 'string'
    );
}

function serializeVaultScan(scan: VaultScanResult): SerializedVaultScan {
  return {
    bindings: sortBindingEntries([...scan.bindings.entries()]),
    duplicatePaths: sortDuplicateEntries([...scan.duplicatePaths.entries()]
      .map(([uuid, notePaths]) => [uuid, [...notePaths].sort()])),
    invalidFrontmatter: sortIssues(scan.invalidFrontmatter)
  };
}

function sortBindingEntries(entries: [string, string][]): [string, string][] {
  return [...entries].sort(([leftUuid, leftPath], [rightUuid, rightPath]) => `${leftUuid}\0${leftPath}`.localeCompare(`${rightUuid}\0${rightPath}`));
}

function sortDuplicateEntries(entries: [string, string[]][]): [string, string[]][] {
  return [...entries].sort(([leftUuid], [rightUuid]) => leftUuid.localeCompare(rightUuid));
}

function sortIssues(issues: readonly ScanIssue[]): ScanIssue[] {
  return [...issues].sort((left, right) => `${left.location}\0${left.message}`.localeCompare(`${right.location}\0${right.message}`));
}
