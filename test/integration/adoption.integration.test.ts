import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  formatCliResult,
  readSandboxPluginId,
  runSandboxCli,
  waitForPluginCommands,
  waitForSandboxModalText
} from './obsidianCliHarness.ts';

describe('adoption integration', () => {
  let pluginId = '';

  beforeAll(async () => {
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
  });

  it('opens an adoption dry-run for exact fixture matches', async () => {
    const commandsResult = await waitForPluginCommands(pluginId);
    assertCliAvailable(commandsResult);

    const debugResult = runSandboxCli(['dev:debug', 'on']);
    expect(debugResult.status, formatCliResult(debugResult)).toBe(0);
    runSandboxCli(['dev:console', 'clear']);
    runSandboxCli([
      'eval',
      'code=document.querySelectorAll(".modal-close-button").forEach((button) => button.click())'
    ]);

    const commandResult = runSandboxCli(['command', `id=${pluginId}:adopt-existing-external-folders`]);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);

    const modalResult = await waitForSandboxModalText('Adopt existing external folders');
    expect(modalResult.status, formatCliResult(modalResult)).toBe(0);
    expect(modalResult.stdout).toContain('Adopt existing external folders');
    expect(modalResult.stdout).toContain('2 adoptable match(es)');
    expect(modalResult.stdout).toContain('tests/exnf-adoption/adopt-exnf-from-plain-note.md');
    expect(modalResult.stdout).toContain('tests/exnf-adoption/adopt-exnf-from-plain-note');
    expect(modalResult.stdout).toContain('tests/exnf-adoption/adopt-exnf-from-folder-note/adopt-exnf-from-folder-note.md');
    expect(modalResult.stdout).toContain('tests/exnf-adoption/adopt-exnf-from-folder-note');
  });
});
