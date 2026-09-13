import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  closeSandboxModals,
  createCliNote,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxCli,
  waitForSandboxModalText
} from './obsidianCliHarness.ts';

const UUID = '123e4567-e89b-42d3-a456-426614179987';
const NOTE_PATH = 'recovery-ui/A long note name for checking the recovery popup path wrapping.md';

describe('open recovery presentation integration', () => {
  afterEach(async () => {
    const result = runSandboxCli([
      'eval',
      'code=globalThis.exnfRecoveryUiCleanup?.(); delete globalThis.exnfRecoveryUiCleanup; delete globalThis.exnfRecoveryUiRelease;'
    ]);
    expect(result.status, formatCliResult(result)).toBe(0);
    await closeSandboxModals();
  });

  it('explains a pending search and its result with wrapping, selectable full paths', async () => {
    const pluginId = await readSandboxPluginId();
    await createCliNote(NOTE_PATH, UUID);
    expect(runSandboxCli(['open', `path=${NOTE_PATH}`]).status).toBe(0);
    await expect.poll(() => runSandboxCli(['eval', 'code=app.workspace.getActiveFile()?.path']).stdout).toContain(NOTE_PATH);
    await expect.poll(() => runSandboxCli(['eval', 'code=app.metadataCache.getFileCache(app.workspace.getActiveFile())?.frontmatter?.exnf']).stdout).toContain(
      UUID
    );

    // Hold only this sandbox scan pending so the production progress modal can be inspected deterministically.
    const holdResult = runSandboxCli([
      'eval',
      `code=(() => {
      const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
      const original = plugin.withProgressModal;
      plugin.withProgressModal = function(title, description, operation, options) {
        return original.call(this, title, description, async () => {
          await new Promise(resolve => { globalThis.exnfRecoveryUiRelease = resolve; });
          return operation();
        }, options);
      };
      globalThis.exnfRecoveryUiCleanup = () => {
        plugin.withProgressModal = original;
        globalThis.exnfRecoveryUiRelease?.();
      };
    })()`
    ]);
    expect(holdResult.status, formatCliResult(holdResult)).toBe(0);
    expect(runSandboxCli(['command', `id=${pluginId}:open-external-folder`]).status).toBe(0);

    const progress = await waitForSandboxModalText('Searching for the external folder', '.external-note-folders-progress-modal');
    expect(progress.status, formatCliResult(progress)).toBe(0);
    expect(progress.stdout).toContain('not found at its expected location');
    expect(progress.stdout).toContain('Searching the external root for a matching .exnf marker file');
    expect(progress.stdout).toContain('older .exnf markers');
    expect(progress.stdout).toContain('configured ignores');
    expect(progress.stdout).toContain('duplicate matches');
    const externalRootPath = path.resolve(resolveRepoPath('test/fixtures/sandbox/external-root'));
    for (const detail of [NOTE_PATH, externalRootPath, path.join(externalRootPath, NOTE_PATH.slice(0, -3)), `${UUID}.exnf`]) {
      expect(progress.stdout).toContain(detail);
    }
    assertDetailsLayout('.external-note-folders-progress-modal');

    expect(runSandboxCli(['eval', 'code=globalThis.exnfRecoveryUiRelease()']).status).toBe(0);
    const results = await waitForSandboxModalText('External folder search results', '.external-note-folders-recovery-modal');
    expect(results.status, formatCliResult(results)).toBe(0);
    expect(results.stdout).toContain('not found at its expected location');
    expect(results.stdout).toContain('No matching .exnf marker');
    expect(results.stdout).not.toContain('found and opened');
    expect(results.stdout).toContain('Ignored or skipped folders are unchecked');
    expect(results.stdout).toContain('Searched root');
    expect(results.stdout).toContain(`${UUID}.exnf`);
    assertDetailsLayout('.external-note-folders-recovery-modal');
  }, 30_000);
});

function assertDetailsLayout(selector: string): void {
  const result = runSandboxCli([
    'eval',
    `code=(() => {
    const modal = document.querySelector(${JSON.stringify(selector)});
    const details = Array.from(modal.querySelectorAll('dd'));
    return details.length === 4 && details.every(el => {
      const style = getComputedStyle(el);
      return style.overflowWrap === 'anywhere' && style.userSelect === 'text' && el.scrollWidth <= el.clientWidth;
    });
  })()`
  ]);
  expect(result.status, formatCliResult(result)).toBe(0);
  expect(result.stdout.trim()).toMatch(/^(?:=> )?true$/u);
}
