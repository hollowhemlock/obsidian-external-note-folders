import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  assertSandboxPluginInstalled,
  formatCliResult,
  getSandboxVaultPath,
  isEnvironmentUnavailable,
  readSandboxPluginId,
  runCli,
  waitForPluginCommands
} from './obsidianCliHarness.ts';

describe('obsidian CLI smoke integration', () => {
  const sandboxVaultPath = getSandboxVaultPath();
  let pluginId = '';

  beforeAll(async () => {
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
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
    expect(combinedOutput).toContain(`${pluginId}:adopt-existing-external-folders`);
    expect(combinedOutput).toContain(`${pluginId}:migrate-legacy-marker-files`);
    expect(combinedOutput).toContain(`${pluginId}:open-external-folder`);
    expect(combinedOutput).toContain(`${pluginId}:reconcile-external-folders`);
    expect(combinedOutput).toContain(`${pluginId}:report-external-folder-drift`);
    expect(combinedOutput).not.toContain(`${pluginId}:verify-external-folders`);
  });
});
