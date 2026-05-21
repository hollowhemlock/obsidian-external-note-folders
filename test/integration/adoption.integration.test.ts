import {
  access,
  readFile
} from 'node:fs/promises';
import path from 'node:path';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import { buildExnfMarkerFileName } from '../../src/core/marker.ts';
import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxCli,
  waitForPluginCommands,
  waitForSandboxModalText
} from './obsidianCliHarness.ts';

const ADOPTION_FIXTURES = [
  {
    externalFolderPath: 'tests/exnf-adoption/adopt-exnf-from-plain-note',
    notePath: 'tests/exnf-adoption/adopt-exnf-from-plain-note.md'
  },
  {
    externalFolderPath: 'tests/exnf-adoption/adopt-exnf-from-folder-note',
    notePath: 'tests/exnf-adoption/adopt-exnf-from-folder-note/adopt-exnf-from-folder-note.md'
  }
] as const;

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
    expect(modalResult.stdout).toContain('Copyable plan');
    expect(modalResult.stdout).toContain('Adopt 2 folder(s)');

    clickSandboxModalButton('Adopt 2 folder(s)');
    const confirmModalResult = await waitForSandboxModalText('Confirm adopt 2 folder(s)');
    expect(confirmModalResult.status, formatCliResult(confirmModalResult)).toBe(0);
    clickSandboxModalButton('Confirm adopt 2 folder(s)');

    for (const fixture of ADOPTION_FIXTURES) {
      await waitForAdoptedBinding(fixture.notePath, fixture.externalFolderPath);
    }

    const rerunResult = runSandboxCli(['command', `id=${pluginId}:adopt-existing-external-folders`]);
    expect(rerunResult.status, formatCliResult(rerunResult)).toBe(0);
    const rerunModalResult = await waitForSandboxModalText('Adopt existing external folders');
    expect(rerunModalResult.status, formatCliResult(rerunModalResult)).toBe(0);
    expect(rerunModalResult.stdout).toContain('0 adoptable match(es)');

    closeSandboxModals();
  }, 30_000);
});

function clickSandboxModalButton(buttonText: string): void {
  const code = [
    'const button = Array.from(document.querySelectorAll(".modal button"))',
    `  .find((element) => element.textContent?.trim() === ${JSON.stringify(buttonText)});`,
    'if (!button) {',
    `  throw new Error(${JSON.stringify(`Missing modal button: ${buttonText}`)});`,
    '}',
    'button.click();'
  ].join('\n');
  const result = runSandboxCli(['eval', `code=${code}`]);
  expect(result.status, formatCliResult(result)).toBe(0);
}

function closeSandboxModals(): void {
  runSandboxCli([
    'eval',
    'code=document.querySelectorAll(".modal-close-button").forEach((button) => button.click())'
  ]);
}

async function readAdoptedBinding(notePath: string, externalFolderPath: string): Promise<string> {
  const noteContent = await readFile(path.join(resolveRepoPath('test/fixtures/sandbox/vault'), notePath), 'utf8');
  const uuid = parseExnfUuid(noteContent);
  const markerPath = path.join(
    resolveRepoPath('test/fixtures/sandbox/external-root'),
    externalFolderPath,
    buildExnfMarkerFileName(uuid)
  );
  await access(markerPath);
  const markerContent = await readFile(markerPath, 'utf8');
  expect(markerContent.trim()).toBe(uuid);
  return uuid;
}

async function waitForAdoptedBinding(notePath: string, externalFolderPath: string): Promise<void> {
  let latestError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await readAdoptedBinding(notePath, externalFolderPath);
      return;
    } catch (error: unknown) {
      latestError = error;
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    }
  }

  throw latestError instanceof Error
    ? latestError
    : new Error(`Adoption did not complete for ${notePath}.`);
}

function parseExnfUuid(noteContent: string): string {
  const match = /^exnf:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/mu.exec(noteContent);
  if (!match?.[1]) {
    throw new Error('Expected adopted note to contain exnf frontmatter.');
  }

  return match[1];
}
