import {
  access,
  readdir,
  readFile
} from 'node:fs/promises';
import path from 'node:path';
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  closeSandboxModals,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxCli,
  waitForPluginCommands,
  waitForSandboxModalText
} from './obsidianCliHarness.ts';

const IMPORTED_UUID = '223e4567-e89b-42d3-a456-426614174090';
const ADDITIONAL_UUID = '423e4567-e89b-42d3-a456-426614174090';
const SETUP_MODAL_SELECTOR = '.modal:has(.external-note-folders-setup-plan-modal)';

describe('external folder setup integration', () => {
  let pluginId = '';

  beforeAll(async () => {
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
  });

  afterEach(async () => {
    await closeSandboxModals();
  });

  it('offers explicit restoration for one exact-path imported marker', async () => {
    const commandsResult = await waitForPluginCommands(pluginId);
    assertCliAvailable(commandsResult);
    const openResult = runSandboxCli(['open', 'path=setup/imported/imported.md']);
    expect(openResult.status, formatCliResult(openResult)).toBe(0);
    await waitForActiveFile('setup/imported/imported.md');

    const commandResult = runSandboxCli(['command', `id=${pluginId}:setup-external-folder`]);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);
    const modalResult = await waitForSandboxModalText('Restore identifier and open', SETUP_MODAL_SELECTOR);
    expect(modalResult.status, formatCliResult(modalResult)).toBe(0);
    expect(modalResult.stdout).toContain('Set up external folder');
    expect(modalResult.stdout).toContain('setup/imported/imported.md');
    expect(modalResult.stdout).toContain(IMPORTED_UUID);
    expect(modalResult.stdout).toContain('complete uniqueness scan');
  }, 30_000);

  it('creates a missing target despite unrelated malformed root evidence', async () => {
    await access(resolveRepoPath('test/fixtures/sandbox/external-root/setup/unrelated/not-a-uuid.exnf'));
    expect(runSandboxCli(['open', 'path=setup/fast/fast.md']).status).toBe(0);
    await waitForActiveFile('setup/fast/fast.md');
    const commandResult = runSandboxCli(['command', `id=${pluginId}:setup-external-folder`]);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);

    const notePath = resolveRepoPath('test/fixtures/sandbox/vault-plugin-external-note-folders-sandbox/setup/fast/fast.md');
    const folderPath = resolveRepoPath('test/fixtures/sandbox/external-root/setup/fast');
    const uuid = await waitForAssignedUuid(notePath);
    await expect(access(path.join(folderPath, `${uuid}.exnf`))).resolves.toBeUndefined();
    expect(await readFile(path.join(folderPath, `${uuid}.exnf`), 'utf8')).toBe('');
  }, 30_000);

  it('opens a matching folder and warns about a delayed additional marker', async () => {
    expect(runSandboxCli(['open', 'path=setup/delayed/delayed.md']).status).toBe(0);
    await waitForActiveFile('setup/delayed/delayed.md');
    const commandResult = runSandboxCli(['command', `id=${pluginId}:open-external-folder`]);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);
    const noticeResult = await waitForSandboxModalText(ADDITIONAL_UUID, '.notice-container');
    expect(noticeResult.status, formatCliResult(noticeResult)).toBe(0);
    expect(noticeResult.stdout).toContain('Report external folder drift');
    expect(await readdir(resolveRepoPath('test/fixtures/sandbox/external-root/setup/delayed'))).toHaveLength(2);
  }, 30_000);
});

async function waitForAssignedUuid(notePath: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const match = /^exnf:\s*([0-9a-f-]+)$/mu.exec(await readFile(notePath, 'utf8'));
    if (match?.[1]) {
      return match[1];
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for setup frontmatter: ${notePath}`);
}

async function waitForActiveFile(expectedPath: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = runSandboxCli(['eval', 'code=app.workspace.getActiveFile()?.path ?? ""']);
    if (result.status === 0 && result.stdout.includes(expectedPath)) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for active file: ${expectedPath}`);
}
