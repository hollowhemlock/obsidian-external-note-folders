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

const CLI_TIMEOUT_MILLISECONDS = 3_000;
const COMMAND_REGISTRATION_ATTEMPTS = 1;
const COMMAND_REGISTRATION_RETRY_DELAY_MILLISECONDS = 500;
const WINDOWS_CLI_CANDIDATES = [
  'Obsidian.com',
  'obsidian.com',
  String.raw`${process.env['LOCALAPPDATA'] ?? ''}\Obsidian\Obsidian.com`,
  String.raw`${process.env['USERPROFILE'] ?? ''}\scoop\apps\obsidian\current\Obsidian.com`
].filter((candidate) => candidate.length > 0);

function formatCliResult(result: CliResult): string {
  return [
    `command: ${result.command}`,
    `status: ${String(result.status)}`,
    `stdout: ${result.stdout || '<empty>'}`,
    `stderr: ${result.stderr || '<empty>'}`,
    `error: ${result.errorMessage || '<none>'}`
  ].join('\n');
}

function isEnvironmentUnavailable(result: CliResult): boolean {
  return result.status === null || result.stdout.includes('Command line interface is not enabled.');
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

function resolvePath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

function runCli(args: readonly string[], vaultPath: string): CliResult {
  const candidates = getCliCandidates();

  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd: vaultPath,
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MILLISECONDS
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForPluginCommands(pluginId: string, vaultPath: string): Promise<CliResult> {
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

describe('obsidian CLI integration', () => {
  const sandboxVaultPath = resolvePath('test/fixtures/sandbox/vault');
  const manifestPath = resolvePath('manifest.json');

  let pluginId = '';

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
  });

  it('has the Obsidian CLI enabled', () => {
    const commandsResult = runCli(['commands'], sandboxVaultPath);
    if (isEnvironmentUnavailable(commandsResult)) {
      console.warn(`Skipping Obsidian CLI assertions because the CLI environment is unavailable.\n${formatCliResult(commandsResult)}`);
      return;
    }

    expect(commandsResult.status, formatCliResult(commandsResult)).toBe(0);

    const combinedOutput = `${commandsResult.stdout}\n${commandsResult.stderr}`.trim();
    expect(
      combinedOutput.length > 0,
      `${
        formatCliResult(commandsResult)
      }\nExpected output. On Windows, use Obsidian.com and ensure CLI is enabled in Settings -> General -> Command line interface.`
    ).toBe(true);

    expect(combinedOutput).toContain('app:');
  });

  it('lists plugin commands for this plugin id', async () => {
    const commandsResult = await waitForPluginCommands(pluginId, sandboxVaultPath);
    if (isEnvironmentUnavailable(commandsResult)) {
      console.warn(`Skipping plugin command assertions because the CLI environment is unavailable.\n${formatCliResult(commandsResult)}`);
      return;
    }

    expect(commandsResult.status, formatCliResult(commandsResult)).toBe(0);

    const combinedOutput = `${commandsResult.stdout}\n${commandsResult.stderr}`;
    expect(
      combinedOutput.includes(pluginId),
      `${formatCliResult(commandsResult)}\nExpected command list to include plugin id '${pluginId}'.`
    ).toBe(true);
  });

  it('exposes the expected plugin commands', async () => {
    const commandsResult = await waitForPluginCommands(pluginId, sandboxVaultPath);
    if (isEnvironmentUnavailable(commandsResult)) {
      console.warn(`Skipping expected command assertions because the CLI environment is unavailable.\n${formatCliResult(commandsResult)}`);
      return;
    }

    expect(commandsResult.status, formatCliResult(commandsResult)).toBe(0);

    const combinedOutput = `${commandsResult.stdout}\n${commandsResult.stderr}`;
    expect(combinedOutput).toContain(`${pluginId}:assign-external-folder-uuid`);
    expect(combinedOutput).toContain(`${pluginId}:open-external-folder`);
    expect(combinedOutput).toContain(`${pluginId}:report-external-folder-drift`);
    expect(combinedOutput).not.toContain(`${pluginId}:verify-external-folders`);
  });
});
