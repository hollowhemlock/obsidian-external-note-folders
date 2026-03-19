import { spawnSync } from 'node:child_process';
import {
  access,
  readFile
} from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

type CliResult = {
  command: string;
  errorMessage: string;
  status: null | number;
  stderr: string;
  stdout: string;
};

type Manifest = {
  id: string;
};

const MIN_OBSIDIAN_CLI_VERSION = [1, 12, 0] as const;
const WINDOWS_CLI_CANDIDATES = [
  'Obsidian.com',
  'obsidian.com',
  String.raw`${process.env['LOCALAPPDATA'] ?? ''}\Obsidian\Obsidian.com`,
  String.raw`${process.env['USERPROFILE'] ?? ''}\scoop\apps\obsidian\current\Obsidian.com`
].filter((candidate) => candidate.length > 0);

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function formatCliResult(result: CliResult): string {
  return [
    `command: ${result.command}`,
    `status: ${String(result.status)}`,
    `stdout: ${result.stdout || '<empty>'}`,
    `stderr: ${result.stderr || '<empty>'}`,
    `error: ${result.errorMessage || '<none>'}`
  ].join('\n');
}

function getCliCandidates(): string[] {
  const configured = process.env['OBSIDIAN_CLI_BIN'];
  if (configured) {
    return [configured];
  }

  if (process.platform === 'win32') {
    return WINDOWS_CLI_CANDIDATES;
  }

  return ['obsidian'];
}

function parseSemverFromText(content: string): null | number[] {
  const match = content.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return match
    .slice(1)
    .map((part) => Number(part));
}

function resolvePath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

function runCli(args: readonly string[], vaultPath: string): CliResult {
  const candidates = getCliCandidates();

  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd: vaultPath,
      encoding: 'utf8',
      timeout: 120_000
    });

    const errorMessage = result.error ? String(result.error.message) : '';
    const output: CliResult = {
      command: `${candidate} ${args.join(' ')}`.trim(),
      errorMessage,
      status: result.status,
      stderr: (result.stderr ?? '').trim(),
      stdout: (result.stdout ?? '').trim()
    };

    if (!result.error || !`${result.error}`.includes('ENOENT')) {
      return output;
    }
  }

  return {
    command: `${candidates.join(' OR ')} ${args.join(' ')}`.trim(),
    errorMessage: 'No Obsidian CLI binary found in configured/default locations.',
    status: null,
    stderr: '',
    stdout: ''
  };
}

describe('obsidian CLI integration', () => {
  const sandboxVaultPath = resolvePath('test/fixtures/sandbox/vault');
  const manifestPath = resolvePath('manifest.json');

  let pluginId = '';
  let versionResult: CliResult;

  beforeAll(async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    pluginId = manifest.id;

    const installedManifestPath = path.join(
      sandboxVaultPath,
      '.obsidian',
      'plugins',
      pluginId,
      'manifest.json'
    );

    await access(installedManifestPath);
    versionResult = runCli(['version'], sandboxVaultPath);
  });

  it('reports Obsidian CLI version 1.12.0 or newer', () => {
    expect(versionResult.status, formatCliResult(versionResult)).toBe(0);
    const combinedOutput = `${versionResult.stdout}\n${versionResult.stderr}`.trim();

    expect(
      combinedOutput.length > 0,
      `${
        formatCliResult(versionResult)
      }\nExpected output. On Windows, use Obsidian.com and ensure CLI is enabled in Settings -> General -> Command line interface.`
    ).toBe(true);

    const parsedVersion = parseSemverFromText(combinedOutput);
    expect(
      parsedVersion,
      `${formatCliResult(versionResult)}\nUnable to parse semantic version from CLI output.`
    ).not.toBeNull();

    expect(
      compareVersions(parsedVersion ?? [], MIN_OBSIDIAN_CLI_VERSION) >= 0,
      `Detected version ${combinedOutput}, expected at least ${MIN_OBSIDIAN_CLI_VERSION.join('.')}.`
    ).toBe(true);
  });

  it('lists plugin commands for this plugin id', () => {
    const commandsResult = runCli(['commands', `filter=${pluginId}`], sandboxVaultPath);
    expect(commandsResult.status, formatCliResult(commandsResult)).toBe(0);

    const combinedOutput = `${commandsResult.stdout}\n${commandsResult.stderr}`;
    expect(
      combinedOutput.includes(pluginId),
      `${formatCliResult(commandsResult)}\nExpected command list to include plugin id '${pluginId}'.`
    ).toBe(true);
  });

  it('can reload the plugin through CLI developer command', () => {
    const reloadResult = runCli(['plugin:reload', `id=${pluginId}`], sandboxVaultPath);
    expect(reloadResult.status, formatCliResult(reloadResult)).toBe(0);
  });
});
