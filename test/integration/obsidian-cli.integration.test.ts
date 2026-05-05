import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  writeFile
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
const COMMAND_REGISTRATION_ATTEMPTS = 5;
const COMMAND_REGISTRATION_RETRY_DELAY_MILLISECONDS = 500;
const DRIFT_MATRIX_PREFIX = `Phase-0-5-Cli-${Date.now().toString()}`;
const DRIFT_UUIDS = {
  malformedReference: '123e4567-e89b-42d3-a456-426614174204',
  moved: '123e4567-e89b-42d3-a456-426614174201',
  occupied: '123e4567-e89b-42d3-a456-426614174202',
  orphan: '123e4567-e89b-42d3-a456-426614174203',
  renamed: '123e4567-e89b-42d3-a456-426614174200'
};
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

function assertCliAvailable(result: CliResult): boolean {
  if (isEnvironmentUnavailable(result)) {
    console.warn(`Skipping Obsidian CLI assertions because the CLI environment is unavailable.\n${formatCliResult(result)}`);
    return false;
  }

  expect(result.status, formatCliResult(result)).toBe(0);
  return true;
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

function runSandboxCli(args: readonly string[]): CliResult {
  return runCli(args, resolvePath('test/fixtures/sandbox/vault'));
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

async function createCliNote(notePath: string, uuid: string): Promise<void> {
  const createResult = runSandboxCli([
    'create',
    `path=${notePath}`,
    `content=---\nexnf: ${uuid}\n---\n\nCLI drift matrix note.`,
    'overwrite'
  ]);
  expect(createResult.status, formatCliResult(createResult)).toBe(0);
}

async function writeMarker(externalFolderRelativePath: string, markerContent: string): Promise<void> {
  const externalRootPath = resolvePath('test/fixtures/sandbox/external-root');
  const folderPath = path.join(externalRootPath, externalFolderRelativePath);
  await mkdir(folderPath, { recursive: true });
  await writeFile(path.join(folderPath, '.exnf'), markerContent, 'utf8');
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

    expect(combinedOutput).not.toContain('Command line interface is not enabled.');
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
    expect(combinedOutput).toContain(`${pluginId}:reconcile-external-folders`);
    expect(combinedOutput).toContain(`${pluginId}:report-external-folder-drift`);
    expect(combinedOutput).not.toContain(`${pluginId}:verify-external-folders`);
  });

  it('executes the read-only drift report command against CLI-created drift scenarios', async () => {
    const commandsResult = await waitForPluginCommands(pluginId, sandboxVaultPath);
    if (!assertCliAvailable(commandsResult)) {
      return;
    }

    const matrixFolder = DRIFT_MATRIX_PREFIX;
    const renamedNotePath = `${matrixFolder}/Renamed/New Name.md`;
    const movedNotePath = `${matrixFolder}/Moved/New Place/Move Me.md`;
    const occupiedNotePath = `${matrixFolder}/Occupied/Target.md`;

    await createCliNote(renamedNotePath, DRIFT_UUIDS.renamed);
    await createCliNote(movedNotePath, DRIFT_UUIDS.moved);
    await createCliNote(occupiedNotePath, DRIFT_UUIDS.occupied);

    await writeMarker(`${matrixFolder}/Renamed/Old Name`, `${DRIFT_UUIDS.renamed}\n`);
    await writeMarker(`${matrixFolder}/Moved/Old Place/Move Me`, `${DRIFT_UUIDS.moved}\n`);
    await writeMarker(`${matrixFolder}/Orphan`, `${DRIFT_UUIDS.orphan}\n`);
    await mkdir(path.join(resolvePath('test/fixtures/sandbox/external-root'), matrixFolder, 'Occupied', 'Target'), { recursive: true });
    await writeMarker(`${matrixFolder}/Malformed`, `${DRIFT_UUIDS.malformedReference.toUpperCase()}\n`);

    const debugResult = runCli(['dev:debug', 'on'], sandboxVaultPath);
    expect(debugResult.status, formatCliResult(debugResult)).toBe(0);
    runCli(['dev:console', 'clear'], sandboxVaultPath);
    runCli([
      'eval',
      'code=document.querySelectorAll(".modal-close-button").forEach((button) => button.click())'
    ], sandboxVaultPath);

    const commandResult = runCli(['command', `id=${pluginId}:report-external-folder-drift`], sandboxVaultPath);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);

    const modalResult = runCli(['dev:dom', 'selector=.modal', 'text'], sandboxVaultPath);
    expect(modalResult.status, formatCliResult(modalResult)).toBe(0);
    expect(modalResult.stdout).toContain('External folder drift report');
    expect(modalResult.stdout).toContain(
      '1 error(s), 2 unexpected path(s), 1 missing expected folder(s), 1 orphan folder(s), 1 occupied target(s), 3 suggestion(s)'
    );
    expect(modalResult.stdout).toContain(renamedNotePath);
    expect(modalResult.stdout).toContain(`${matrixFolder}/Renamed/Old Name`);
    expect(modalResult.stdout).toContain(movedNotePath);
    expect(modalResult.stdout).toContain(`${matrixFolder}/Moved/Old Place/Move Me`);
    expect(modalResult.stdout).toContain(`${matrixFolder}/Orphan`);
    expect(modalResult.stdout).toContain(`${matrixFolder}/Occupied/Target`);
    expect(modalResult.stdout).toContain('Unmarked folder occupies expected path.');
    expect(modalResult.stdout).toContain('Malformed marker at');

    const consoleResult = runCli(['dev:console', 'level=debug', 'limit=10'], sandboxVaultPath);
    expect(consoleResult.status, formatCliResult(consoleResult)).toBe(0);
    expect(consoleResult.stdout).toContain('[external-note-folders] drift report started');
    expect(consoleResult.stdout).toContain('[external-note-folders] drift report complete');
  });
});
