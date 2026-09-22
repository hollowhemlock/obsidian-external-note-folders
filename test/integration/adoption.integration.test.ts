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

import { buildExnfMarkerFileName } from '../../src/core/marker.ts';
import {
  assertCliAvailable,
  assertSandboxPluginInstalled,
  closeSandboxModals,
  enableSandboxConsoleCapture,
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

interface ExpectedMovedFolderShape {
  ambiguity: {
    folderCount: number;
    folderSamples: string[];
    normalizedName: string;
    noteCount: number;
    noteSamples: string[];
  };
  domain: 'moved-folder-suggestions';
  payloads: {
    content: string;
    fileName: string;
    folderPath: string;
  }[];
  schemaVersion: 1;
  scenario: 'modal-smoke';
  summary: {
    ambiguousNames: number;
    errors: number;
    ignoredDirectories: number;
    skippedDirectories: number;
    uniqueSuggestions: number;
    warningGroups: number;
  };
  uniqueSuggestion: {
    candidateExternalFolder: string;
    expectedExternalFolder: string;
    notePath: string;
  };
}

const ADOPTION_MODAL_SELECTOR = '.modal:has(.external-note-folders-adoption-plan-modal)';
const MOVED_SUGGESTION_MODAL_SELECTOR = '.modal:has(.external-note-folders-moved-folder-suggestion-modal)';

describe('adoption integration', () => {
  let expectedAdoptionShape: ExpectedAdoptionShape;
  let expectedMovedFolderShape: ExpectedMovedFolderShape;
  let pluginId = '';

  beforeAll(async () => {
    expectedAdoptionShape = await readExpectedAdoptionShape();
    expectedMovedFolderShape = await readExpectedMovedFolderShape();
    pluginId = await readSandboxPluginId();
    await assertSandboxPluginInstalled(pluginId);
  });

  afterEach(async () => {
    await closeSandboxModals();
  });

  it('opens the read-only moved-folder suggestion report', async () => {
    const commandsResult = await waitForPluginCommands(pluginId);
    assertCliAvailable(commandsResult);
    await closeSandboxModals();

    const commandResult = runSandboxCli(['command', `id=${pluginId}:suggest-moved-external-folder-matches`]);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);

    const modalResult = await waitForSandboxModalText('Suggest moved external folder matches', MOVED_SUGGESTION_MODAL_SELECTOR);
    expect(modalResult.status, formatCliResult(modalResult)).toBe(0);
    await writeSandboxReport('adoption/moved-folder-suggestions-modal.txt', modalResult.stdout);
    const normalizedModalText = normalizePathSeparators(modalResult.stdout);
    expect(modalResult.stdout).toContain('Read-only report');
    expect(modalResult.stdout).toContain('vault-path:');
    expect(normalizedModalText).toContain(normalizePathSeparators(getSandboxVaultPath()));
    expect(modalResult.stdout).toContain('external-root:');
    expect(normalizedModalText).toContain(normalizePathSeparators(resolveRepoPath('test/fixtures/sandbox/external-root')));
    expect(modalResult.stdout).toContain('unique only among checked eligible paths');
    expect(modalResult.stdout).toContain('Safe adoption workflow');
    expect(modalResult.stdout).toContain(formatMovedFolderSummary(expectedMovedFolderShape));
    expect(modalResult.stdout).toContain(
      `moved-folder-suggestions: ${
        String(expectedMovedFolderShape.summary.uniqueSuggestions)
      } suggestion(s) — ${expectedMovedFolderShape.uniqueSuggestion.notePath}`
    );
    expect(modalResult.stdout).toContain(
      `${expectedMovedFolderShape.ambiguity.normalizedName}: ${String(expectedMovedFolderShape.ambiguity.noteCount)} note(s), ${
        String(expectedMovedFolderShape.ambiguity.folderCount)
      } folder(s)`
    );
    for (const notePath of expectedMovedFolderShape.ambiguity.noteSamples) {
      expect(modalResult.stdout).toContain(notePath);
    }
    for (const folderPath of expectedMovedFolderShape.ambiguity.folderSamples) {
      expect(modalResult.stdout).toContain(folderPath);
    }
    expect(modalResult.stdout).not.toContain('Confirm adopt');

    const suggestionRowSelector = `${MOVED_SUGGESTION_MODAL_SELECTOR} .external-note-folders-moved-suggestion-group tbody tr`;
    assertSandboxElementCount(`${MOVED_SUGGESTION_MODAL_SELECTOR} .external-note-folders-moved-ambiguity-group`, 1);
    assertSandboxElementCount(suggestionRowSelector, 0);
    clickSandboxElement(`${MOVED_SUGGESTION_MODAL_SELECTOR} .external-note-folders-moved-suggestion-group > summary`);
    assertSandboxElementCount(suggestionRowSelector, 1);

    const expandedModalResult = await waitForSandboxModalText(
      expectedMovedFolderShape.uniqueSuggestion.candidateExternalFolder,
      MOVED_SUGGESTION_MODAL_SELECTOR
    );
    expect(expandedModalResult.status, formatCliResult(expandedModalResult)).toBe(0);
    expect(expandedModalResult.stdout).toContain(expectedMovedFolderShape.uniqueSuggestion.notePath);
    expect(expandedModalResult.stdout).toContain(expectedMovedFolderShape.uniqueSuggestion.expectedExternalFolder);
    expect(expandedModalResult.stdout).toContain(expectedMovedFolderShape.uniqueSuggestion.candidateExternalFolder);

    await closeSandboxModals();
    await expectMovedFolderFixtureUnchanged(expectedMovedFolderShape);
  }, 30_000);

  it('opens an adoption dry-run for exact fixture matches', async () => {
    const commandsResult = await waitForPluginCommands(pluginId);
    assertCliAvailable(commandsResult);

    const debugResult = enableSandboxConsoleCapture();
    expect(debugResult.status, formatCliResult(debugResult)).toBe(0);
    runSandboxCli(['dev:console', 'clear']);
    await closeSandboxModals();

    const commandResult = runSandboxCli(['command', `id=${pluginId}:adopt-existing-external-folders`]);
    expect(commandResult.status, formatCliResult(commandResult)).toBe(0);

    const modalResult = await waitForSandboxModalText('Adopt exact-path external folders', ADOPTION_MODAL_SELECTOR);
    expect(modalResult.status, formatCliResult(modalResult)).toBe(0);
    await writeSandboxReport('adoption/dry-run-modal.txt', modalResult.stdout);
    const normalizedModalText = normalizePathSeparators(modalResult.stdout);
    expect(modalResult.stdout).toContain('Adopt exact-path external folders');
    expect(modalResult.stdout).toContain('vault-path:');
    expect(normalizedModalText).toContain(normalizePathSeparators(getSandboxVaultPath()));
    expect(modalResult.stdout).toContain('external-root:');
    expect(normalizedModalText).toContain(normalizePathSeparators(resolveRepoPath('test/fixtures/sandbox/external-root')));
    expect(modalResult.stdout).toContain(`${String(expectedAdoptionShape.adoptions.length)} adoptable match(es)`);
    for (const expectedAdoption of expectedAdoptionShape.adoptions) {
      expect(modalResult.stdout).toContain(expectedAdoption.notePath);
      expect(modalResult.stdout).toContain(expectedAdoption.externalFolderPath);
    }
    expect(modalResult.stdout).toContain('Copyable plan');
    expect(modalResult.stdout).toContain(`Adopt ${String(expectedAdoptionShape.adoptions.length)} folder(s)`);

    clickSandboxModalButton(`Adopt ${String(expectedAdoptionShape.adoptions.length)} folder(s)`);
    const confirmModalResult = await waitForSandboxModalText(
      `Confirm adopt ${String(expectedAdoptionShape.adoptions.length)} folder(s)`,
      ADOPTION_MODAL_SELECTOR
    );
    expect(confirmModalResult.status, formatCliResult(confirmModalResult)).toBe(0);
    clickSandboxModalButton(`Confirm adopt ${String(expectedAdoptionShape.adoptions.length)} folder(s)`);

    for (const expectedAdoption of expectedAdoptionShape.adoptions) {
      await waitForAdoptedBinding(expectedAdoption);
    }

    // Close the just-confirmed plan modal first. Its "Confirm adopt N folder(s)" arm state stays
    // in the DOM and shares the "Adopt exact-path external folders" heading with a fresh scan, so
    // waiting on the heading would re-capture the stale modal instead of the post-adoption rescan.
    await closeSandboxModals();

    const rerunResult = runSandboxCli(['command', `id=${pluginId}:adopt-existing-external-folders`]);
    expect(rerunResult.status, formatCliResult(rerunResult)).toBe(0);
    const afterApplyMatchesText = `${String(expectedAdoptionShape.afterApply.adoptableMatches)} adoptable match(es)`;
    const rerunModalResult = await waitForSandboxModalText(afterApplyMatchesText, ADOPTION_MODAL_SELECTOR);
    expect(rerunModalResult.status, formatCliResult(rerunModalResult)).toBe(0);
    await writeSandboxReport('adoption/after-apply-modal.txt', rerunModalResult.stdout);
    expect(rerunModalResult.stdout).toContain('Adopt exact-path external folders');
    expect(rerunModalResult.stdout).toContain(afterApplyMatchesText);

    await closeSandboxModals();
  }, 30_000);
});

function assertSandboxElementCount(selector: string, expectedCount: number): void {
  const code = [
    `const selector = ${JSON.stringify(selector)};`,
    'const actualCount = document.querySelectorAll(selector).length;',
    `if (actualCount !== ${String(expectedCount)}) {`,
    '  throw new Error(`Expected ${selector} to match ${expectedCount} element(s), found ${actualCount}.`);',
    '}'
  ].join('\n');
  const result = runSandboxCli(['eval', `code=${code}`]);
  expect(result.status, formatCliResult(result)).toBe(0);
}

function clickSandboxElement(selector: string): void {
  const code = [
    `const selector = ${JSON.stringify(selector)};`,
    'const element = document.querySelector(selector);',
    'if (!(element instanceof HTMLElement)) {',
    '  throw new Error(`Missing HTML element: ${selector}`);',
    '}',
    'element.click();'
  ].join('\n');
  const result = runSandboxCli(['eval', `code=${code}`]);
  expect(result.status, formatCliResult(result)).toBe(0);
}

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
  expect(markerContent).toBe('');
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

async function expectMovedFolderFixtureUnchanged(expected: ExpectedMovedFolderShape): Promise<void> {
  const notePaths = [expected.uniqueSuggestion.notePath, ...expected.ambiguity.noteSamples];
  for (const notePath of notePaths) {
    const noteContent = await readFile(path.join(getSandboxVaultPath(), ...notePath.split('/')), 'utf8');
    expect(noteContent).not.toMatch(/^exnf:/mu);
  }

  const externalRootPath = resolveRepoPath('test/fixtures/sandbox/external-root');
  for (const payload of expected.payloads) {
    const folderPath = path.join(externalRootPath, ...payload.folderPath.split('/'));
    const entries = await readdir(folderPath);
    expect(entries.some((entry) => entry.endsWith('.exnf'))).toBe(false);
    expect(await readFile(path.join(folderPath, payload.fileName), 'utf8')).toBe(payload.content);
  }
}

function formatMovedFolderSummary(expected: ExpectedMovedFolderShape): string {
  const { summary } = expected;
  return [
    `${String(summary.errors)} error(s)`,
    `${String(summary.warningGroups)} warning group(s)`,
    `${String(summary.ignoredDirectories)} ignored external directories`,
    `${String(summary.skippedDirectories)} skipped external directories`,
    `${String(summary.uniqueSuggestions)} unique suggestion(s)`,
    `${String(summary.ambiguousNames)} ambiguous name(s)`
  ].join(', ');
}

async function readExpectedMovedFolderShape(): Promise<ExpectedMovedFolderShape> {
  const content = await readFile(resolveRepoPath('test/fixtures/fixture/expected/moved-folder-suggestions/modal-smoke.json'), 'utf8');
  const parsed = JSON.parse(content) as unknown;
  if (!isExpectedMovedFolderShape(parsed)) {
    throw new Error('Invalid expected moved-folder modal fixture.');
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

function isExpectedMovedFolderShape(input: unknown): input is ExpectedMovedFolderShape {
  if (typeof input !== 'object' || input === null) {
    return false;
  }
  const candidate = input as Partial<ExpectedMovedFolderShape>;
  return candidate.schemaVersion === 1
    && candidate.domain === 'moved-folder-suggestions'
    && candidate.scenario === 'modal-smoke'
    && typeof candidate.summary === 'object'
    && candidate.summary !== null
    && Object.values(candidate.summary).every((value) => typeof value === 'number')
    && typeof candidate.uniqueSuggestion?.notePath === 'string'
    && typeof candidate.uniqueSuggestion.expectedExternalFolder === 'string'
    && typeof candidate.uniqueSuggestion.candidateExternalFolder === 'string'
    && typeof candidate.ambiguity?.normalizedName === 'string'
    && typeof candidate.ambiguity.noteCount === 'number'
    && typeof candidate.ambiguity.folderCount === 'number'
    && Array.isArray(candidate.ambiguity.noteSamples)
    && candidate.ambiguity.noteSamples.every((value) => typeof value === 'string')
    && Array.isArray(candidate.ambiguity.folderSamples)
    && candidate.ambiguity.folderSamples.every((value) => typeof value === 'string')
    && Array.isArray(candidate.payloads)
    && candidate.payloads.every((payload) =>
      typeof payload.content === 'string'
      && typeof payload.fileName === 'string'
      && typeof payload.folderPath === 'string'
    );
}

function parseExnfUuid(noteContent: string): string {
  const match = /^exnf:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/mu.exec(noteContent);
  if (!match?.[1]) {
    throw new Error('Expected adopted note to contain exnf frontmatter.');
  }

  return match[1];
}

function normalizePathSeparators(input: string): string {
  return input.replaceAll('\\', '/');
}
