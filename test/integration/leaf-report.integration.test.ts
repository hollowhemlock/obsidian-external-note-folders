import {
  mkdir,
  readdir,
  readFile
} from 'node:fs/promises';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { buildLeafReport } from '../../src/core/leafReport.ts';
import { auditFixture } from '../support/auditFixture.ts';
import {
  closeSandboxModals,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxCli,
  waitForPluginCommands,
  waitForSandboxModalText,
  writeSandboxReport
} from './obsidianCliHarness.ts';

const VIEW_TYPE = 'external-note-folders-leaf-report';
const EXPORT_SELECTOR = '.modal:has(.external-note-folders-audit-destination)';
const REPORT_SELECTOR = '.workspace-leaf-content[data-type="external-note-folders-leaf-report"]';

function evaluate(code: string): string {
  const result = runSandboxCli(['eval', `code=${code}`]);

  expect(result.status, formatCliResult(result)).toBe(0);

  return result.stdout;
}

describe('shared leaf report integration', () => {
  beforeEach(async () => {
    await closeSandboxModals();
  });
  afterEach(async () => {
    await closeSandboxModals();
    evaluate(`app.workspace.detachLeavesOfType('${VIEW_TYPE}')`);
  });
  it('reuses one tab, preserves refresh results, exports and disposes', async () => {
    const pluginId = await readSandboxPluginId();

    const command = `${pluginId}:explore-unmarked-external-leaf-folders`;

    expect((await waitForPluginCommands(pluginId)).stdout).toContain(command);

    runSandboxCli(['command', `id=${command}`]);

    expect((await waitForSandboxModalText('Scan complete.', REPORT_SELECTOR)).stdout).toContain('Full physical audit');

    runSandboxCli(['command', `id=${command}`]);

    expect(evaluate(`app.workspace.getLeavesOfType('${VIEW_TYPE}').length`)).toContain('1');

    const view = `app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view`;

    expect(
      evaluate(
        `(async()=>{const v=${view};const before=v.session.model;const p=v.session.refresh();v.session.cancel();await p;return v.session.model===before;})()`
      )
    ).toContain('true');

    const destination = resolveRepoPath('tmp/leaf-integration-exports');

    await mkdir(destination, { recursive: true });

    const before = new Set(await readdir(destination));

    evaluate(`Array.from(${view}.contentEl.querySelectorAll('button')).find(b=>b.textContent==='Export all leaves').click()`);

    await waitForSandboxModalText('Absolute destination directory', EXPORT_SELECTOR);

    evaluate(
      `(()=>{const input=document.querySelector('.external-note-folders-audit-destination');input.value='relative';input.closest('form').requestSubmit();})()`
    );

    expect((await waitForSandboxModalText('Enter an existing, writable absolute directory.', EXPORT_SELECTOR)).stdout).toContain('Enter an existing');

    evaluate(
      `(()=>{const input=document.querySelector('.external-note-folders-audit-destination');input.value=${
        JSON.stringify(destination)
      };input.closest('form').requestSubmit();})()`
    );

    expect((await waitForSandboxModalText('Exported to', REPORT_SELECTOR)).stdout).toContain('Exported to');

    const output = (await readdir(destination)).find((name) => !before.has(name));

    expect(output).toBeDefined();

    expect(await readFile(path.join(destination, output ?? '', 'unmarked-leaf-folders.csv'), 'utf8')).toContain('"folderPath","relativePath"');

    evaluate(`app.workspace.detachLeavesOfType('${VIEW_TYPE}')`);

    expect(evaluate(`app.workspace.getLeavesOfType('${VIEW_TYPE}').length`)).toContain('0');
  }, 60_000);

  it('renders, filters and paginates 20,000 leaves using the shared model', async () => {
    const pluginId = await readSandboxPluginId();

    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);

    await waitForSandboxModalText('Scan complete.', REPORT_SELECTOR);

    const fixture = auditFixture(20_000);

    fixture.folders = fixture.folders.map((folder, index) =>
      path.join(fixture.externalRoot, `group-${String(Math.floor(index / 200))}`, path.basename(folder))
    );
    fixture.notes = fixture.folders.map((folderPath) => {
      const relativePath = path.relative(fixture.externalRoot, folderPath).split(path.sep).join('/') + '.md';
      return { hasExnf: false, notePath: path.join(fixture.vaultRoot, relativePath), relativePath, status: 'missing-property', uuid: '', value: '' };
    });
    const model = buildLeafReport(fixture);

    const modelPath = resolveRepoPath('tmp/leaf-integration-model.json');

    const { writeFile } = await import('node:fs/promises');

    await writeFile(modelPath, JSON.stringify(model));

    const view = `app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view`;

    const rendered = evaluate(
      `(async()=>{const v=${view};const m=JSON.parse(require('fs').readFileSync(${
        JSON.stringify(modelPath)
      },'utf8'));let maxTask=0;const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())maxTask=Math.max(maxTask,entry.duration)});observer.observe({entryTypes:['longtask']});const started=performance.now();await v.report.update(m);await new Promise(r=>setTimeout(r,30));const el=v.contentEl;el.querySelector('.leaf-group-toggle').click();await new Promise(r=>setTimeout(r,30));const rows=el.querySelectorAll('.leaf-row').length;const page=el.querySelector('.leaf-rows .leaf-pagination');page.querySelectorAll('button')[1].click();await new Promise(r=>setTimeout(r,30));const secondPage=el.querySelector('.leaf-rows .leaf-pagination').textContent;const groups=el.querySelectorAll('.leaf-group').length;const search=el.querySelector('input[type=search]');search.value='folder-19999';search.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,100));const filtered=el.querySelector('.leaf-stats').textContent;observer.disconnect();return JSON.stringify({totalMs:performance.now()-started,maxTask,rows,groups,secondPage,filtered});})()`
    );

    expect(rendered).toContain('"rows":100');
    expect(rendered).toContain('"groups":50');
    expect(rendered).toContain('Page 2 of 2');

    expect(rendered).toContain('1 displayed');

    await writeSandboxReport('leaf-report/performance.json', rendered);

    const match = /"maxTask":(?<duration>[\d.]+)/u.exec(rendered)?.groups?.['duration'];

    expect(Number(match)).toBeLessThanOrEqual(100);

    evaluate(`app.workspace.detachLeavesOfType('${VIEW_TYPE}')`);
  }, 60_000);
});
