import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  enableSandboxConsoleCapture,
  formatCliResult,
  getSandboxVaultPath,
  readSandboxPluginId,
  runCli,
  waitForPluginCommands,
  waitForSandboxModalText,
  writeSandboxReport
} from './obsidianCliHarness.ts';

const DRIFT_SCENARIO_PATH = 'drift-report/basic-drift-matrix';

describe('drift report integration', () => {
  const sandboxVaultPath = getSandboxVaultPath();
  let pluginId = '';

  beforeAll(async () => {
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
  });

  it('executes the read-only drift report command against committed drift fixtures', async () => {
    const commandsResult = await waitForPluginCommands(pluginId, sandboxVaultPath);
    assertCliAvailable(commandsResult);

    const debugResult = enableSandboxConsoleCapture(sandboxVaultPath);
    expect(debugResult.status, formatCliResult(debugResult)).toBe(0);
    runCli(['dev:console', 'clear'], sandboxVaultPath);
    runCli([
      'eval',
      'code=document.querySelectorAll(".modal-close-button").forEach((button) => button.click())'
    ], sandboxVaultPath);

    const commandResult = runCli(['command', `id=${pluginId}:report-external-folder-drift`], sandboxVaultPath);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);

    // The command opens a progress modal first, then swaps in the report modal once the
    // scan completes. Wait for content unique to the finished report ("Copyable report" is
    // absent from the progress modal) rather than reading the DOM before it renders.
    const modalResult = await waitForSandboxModalText('Copyable report');
    expect(modalResult.status, formatCliResult(modalResult)).toBe(0);
    await writeSandboxReport('drift-report/basic-drift-matrix/modal.md', modalResult.stdout);
    expect(modalResult.stdout).toContain('External folder drift report');
    expect(modalResult.stdout).toContain(`${DRIFT_SCENARIO_PATH}/Moved/New Place/Move Me.md`);
    expect(modalResult.stdout).toContain('Copyable report');

    const consoleResult = runCli(['dev:console', 'level=debug', 'limit=10'], sandboxVaultPath);
    expect(consoleResult.status, formatCliResult(consoleResult)).toBe(0);
    expect(consoleResult.stdout).toContain('[external-note-folders] drift report started');
    expect(consoleResult.stdout).toContain('[external-note-folders] drift report complete');
  });
});
