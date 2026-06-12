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
  getSandboxVaultPath,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxCli,
  waitForPluginCommands,
  waitForSandboxModalText,
  writeSandboxReport
} from './obsidianCliHarness.ts';

interface ExpectedAdoption {
  externalFolderPath: string;
  externalPayloadFiles: string[];
  notePath: string;
}

interface ExpectedAdoptionShape {
  adoptions: ExpectedAdoption[];
  afterApply: {
    adoptableMatches: number;
  };
}

describe('adoption integration', () => {
  let expectedShape: ExpectedAdoptionShape;
  let pluginId = '';

  beforeAll(async () => {
    expectedShape = await readExpectedAdoptionShape();
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
    await writeSandboxReport('adoption/dry-run-modal.txt', modalResult.stdout);
    expect(modalResult.stdout).toContain('Adopt existing external folders');
    expect(modalResult.stdout).toContain(`${String(expectedShape.adoptions.length)} adoptable match(es)`);
    for (const expectedAdoption of expectedShape.adoptions) {
      expect(modalResult.stdout).toContain(expectedAdoption.notePath);
      expect(modalResult.stdout).toContain(expectedAdoption.externalFolderPath);
    }
    expect(modalResult.stdout).toContain('Copyable plan');
    expect(modalResult.stdout).toContain(`Adopt ${String(expectedShape.adoptions.length)} folder(s)`);

    clickSandboxModalButton(`Adopt ${String(expectedShape.adoptions.length)} folder(s)`);
    const confirmModalResult = await waitForSandboxModalText(`Confirm adopt ${String(expectedShape.adoptions.length)} folder(s)`);
    expect(confirmModalResult.status, formatCliResult(confirmModalResult)).toBe(0);
    clickSandboxModalButton(`Confirm adopt ${String(expectedShape.adoptions.length)} folder(s)`);

    for (const expectedAdoption of expectedShape.adoptions) {
      await waitForAdoptedBinding(expectedAdoption);
    }

    const rerunResult = runSandboxCli(['command', `id=${pluginId}:adopt-existing-external-folders`]);
    expect(rerunResult.status, formatCliResult(rerunResult)).toBe(0);
    const rerunModalResult = await waitForSandboxModalText('Adopt existing external folders');
    expect(rerunModalResult.status, formatCliResult(rerunModalResult)).toBe(0);
    await writeSandboxReport('adoption/after-apply-modal.txt', rerunModalResult.stdout);
    expect(rerunModalResult.stdout).toContain(`${String(expectedShape.afterApply.adoptableMatches)} adoptable match(es)`);

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

async function readAdoptedBinding(expectedAdoption: ExpectedAdoption): Promise<string> {
  const noteContent = await readFile(
    path.join(getSandboxVaultPath(), expectedAdoption.notePath),
    'utf8'
  );
  const uuid = parseExnfUuid(noteContent);
  const externalFolderPath = path.join(
    resolveRepoPath('test/fixtures/sandbox/external-root'),
    expectedAdoption.externalFolderPath
  );
  const markerPath = path.join(
    externalFolderPath,
    buildExnfMarkerFileName(uuid)
  );
  await access(markerPath);
  const markerContent = await readFile(markerPath, 'utf8');
  expect(markerContent.trim()).toBe(uuid);
  for (const payloadFile of expectedAdoption.externalPayloadFiles) {
    await access(path.join(externalFolderPath, payloadFile));
  }
  return uuid;
}

async function readExpectedAdoptionShape(): Promise<ExpectedAdoptionShape> {
  const content = await readFile(resolveRepoPath('test/fixtures/fixture/expected/exnf-adoption/post-adoption.json'), 'utf8');
  const parsed = JSON.parse(content) as unknown;
  if (!isExpectedAdoptionShape(parsed)) {
    throw new Error('Invalid expected adoption post-state fixture.');
  }

  return parsed;
}

async function waitForAdoptedBinding(expectedAdoption: ExpectedAdoption): Promise<void> {
  let latestError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await readAdoptedBinding(expectedAdoption);
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
    : new Error(`Adoption did not complete for ${expectedAdoption.notePath}.`);
}

function isExpectedAdoption(input: unknown): input is ExpectedAdoption {
  return typeof input === 'object'
    && input !== null
    && 'externalFolderPath' in input
    && typeof input.externalFolderPath === 'string'
    && 'externalPayloadFiles' in input
    && Array.isArray(input.externalPayloadFiles)
    && input.externalPayloadFiles.every((payloadFile) => typeof payloadFile === 'string')
    && 'notePath' in input
    && typeof input.notePath === 'string';
}

function isExpectedAdoptionShape(input: unknown): input is ExpectedAdoptionShape {
  return typeof input === 'object'
    && input !== null
    && 'adoptions' in input
    && Array.isArray(input.adoptions)
    && input.adoptions.every(isExpectedAdoption)
    && 'afterApply' in input
    && typeof input.afterApply === 'object'
    && input.afterApply !== null
    && 'adoptableMatches' in input.afterApply
    && typeof input.afterApply.adoptableMatches === 'number';
}

function parseExnfUuid(noteContent: string): string {
  const match = /^exnf:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/mu.exec(noteContent);
  if (!match?.[1]) {
    throw new Error('Expected adopted note to contain exnf frontmatter.');
  }

  return match[1];
}
