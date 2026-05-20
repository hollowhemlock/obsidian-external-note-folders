import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  createCliNote,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runCli,
  waitForPluginCommands,
  writeMarker
} from './obsidianCliHarness.ts';

const DRIFT_MATRIX_PREFIX = `Phase-0-5-Cli-${Date.now().toString()}`;
const DRIFT_UUIDS = {
  malformedReference: '123e4567-e89b-42d3-a456-426614174204',
  moved: '123e4567-e89b-42d3-a456-426614174201',
  occupied: '123e4567-e89b-42d3-a456-426614174202',
  orphan: '123e4567-e89b-42d3-a456-426614174203',
  renamed: '123e4567-e89b-42d3-a456-426614174200'
};

describe('drift report integration', () => {
  const sandboxVaultPath = resolveRepoPath('test/fixtures/sandbox/vault');
  let pluginId = '';

  beforeAll(async () => {
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
  });

  it('executes the read-only drift report command against CLI-created drift scenarios', async () => {
    const commandsResult = await waitForPluginCommands(pluginId, sandboxVaultPath);
    assertCliAvailable(commandsResult);

    const matrixFolder = DRIFT_MATRIX_PREFIX;
    const renamedNotePath = `${matrixFolder}/Renamed/New Name.md`;
    const movedNotePath = `${matrixFolder}/Moved/New Place/Move Me.md`;
    const occupiedNotePath = `${matrixFolder}/Occupied/Target.md`;

    await createCliNote(renamedNotePath, DRIFT_UUIDS.renamed);
    await createCliNote(movedNotePath, DRIFT_UUIDS.moved);
    await createCliNote(occupiedNotePath, DRIFT_UUIDS.occupied);

    await writeMarker(`${matrixFolder}/Renamed/Old Name`, DRIFT_UUIDS.renamed);
    await writeMarker(`${matrixFolder}/Moved/Old Place/Move Me`, DRIFT_UUIDS.moved);
    await writeMarker(`${matrixFolder}/Orphan`, DRIFT_UUIDS.orphan);
    await mkdir(path.join(resolveRepoPath('test/fixtures/sandbox/external-root'), matrixFolder, 'Occupied', 'Target'), { recursive: true });
    await writeMarker(`${matrixFolder}/Malformed`, DRIFT_UUIDS.malformedReference, `${DRIFT_UUIDS.malformedReference.toUpperCase()}\n`);

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
      '1 error(s), 0 warning(s), 2 unexpected path(s), 1 missing expected folder(s), 1 orphan folder(s), 1 occupied target(s), 3 suggestion(s)'
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
