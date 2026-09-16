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
    evaluate(`document.querySelector('${REPORT_SELECTOR} .leaf-tree-item')?.click()`);
    await waitForSandboxModalText('Adopt this folder', REPORT_SELECTOR);

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

  it('preserves a selected anchor beyond 100 siblings and handles hidden, removed and cancelled selections', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete.', REPORT_SELECTOR);
    const fixture = auditFixture();
    fixture.notes = [];
    fixture.folders = [path.join(fixture.externalRoot, 'a-target')];
    for (let index = 0; index < 205; index++) {
      for (const suffix of ['', '/one', '/two']) {
        fixture.folders.push(path.join(fixture.externalRoot, `b-${String(index)}${suffix}`));
      }
    }
    const modelPath = resolveRepoPath('tmp/leaf-tree-state-model.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(modelPath, JSON.stringify(buildLeafReport(fixture)));
    const result = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const model=JSON.parse(require('fs').readFileSync(${JSON.stringify(modelPath)},'utf8'));
      await v.report.update(model);
      const el=v.contentEl;
      const wait=async()=>{await new Promise(r=>setTimeout(r,30));for(let i=0;i<100 && el.querySelector('.exnf-leaf-report').getAttribute('aria-busy')==='true';i++)await new Promise(r=>setTimeout(r,20));};
      const tree=el.querySelector('.leaf-tree');
      const ordered=()=>{const tops=Array.from(tree.querySelectorAll('.leaf-tree-item')).map(row=>parseFloat(row.style.top));return tops.every((top,i)=>i===0||top>tops[i-1]);};
      const branch=Array.from(tree.querySelectorAll('.leaf-tree-item')).find(row=>row.title==='b-0');
      branch.click();await wait();
      const expansionOrder=ordered();
      branch.click();await wait();
      const initial=tree.querySelector('.leaf-tree-item');initial.click();await wait();
      tree.scrollTop=80*36;tree.dispatchEvent(new Event('scroll'));
      const scrollFocus=document.activeElement===tree;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      const resumedKeyboard=document.activeElement.getAttribute('role')==='treeitem';
      tree.focus();tree.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
      tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait();
      const paged=document.activeElement.textContent.includes('b-99');
      tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      const first=el.querySelector('.leaf-tree-item'); first.focus(); first.click(); await wait();
      const sort=el.querySelector('[aria-label="Sort siblings"]'); sort.value='count';sort.dispatchEvent(new Event('change'));await wait();
      const anchored=document.activeElement.textContent.includes('a-target') && tree.scrollTop>100*36;
      const sortOrder=ordered();
      const search=el.querySelector('input[type=search]'); search.value='b-0';search.dispatchEvent(new Event('input'));await wait();
      const hidden=el.querySelector('.leaf-details').textContent.includes('hidden by the current filters');
      search.value='';search.dispatchEvent(new Event('input'));await wait();
      const retained=el.querySelector('.leaf-details h2')?.textContent==='a-target';
      const before=el.querySelector('.leaf-stats').textContent;
      const abort=new AbortController();abort.abort();
      try{await v.report.update({...model,rows:[]},abort.signal)}catch{}
      const cancelled=el.querySelector('.leaf-stats').textContent===before;
      await v.report.update({...model,rows:model.rows.filter(r=>!r.relativePath.includes('a-target')),tree:model.tree.filter(n=>n.relativePath!=='a-target')});
      const removed=el.querySelector('.leaf-details').textContent.includes('Select a folder');
      tree.focus();tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      const keyboard=document.activeElement.getAttribute('role')==='treeitem';
      const report=el.querySelector('.exnf-leaf-report');
      report.style.width='600px';
      const layout=el.querySelector('.leaf-layout');
      const narrow=getComputedStyle(layout).gridTemplateColumns.split(' ').length===1;
      report.style.removeProperty('width');
      return JSON.stringify({anchored,hidden,retained,cancelled,removed,keyboard,paged,narrow,expansionOrder,sortOrder,scrollFocus,resumedKeyboard});
    })()`);
    for (
      const key of [
        'anchored',
        'hidden',
        'retained',
        'cancelled',
        'removed',
        'keyboard',
        'paged',
        'narrow',
        'expansionOrder',
        'sortOrder',
        'scrollFocus',
        'resumedKeyboard'
      ]
    ) {
      expect(result).toContain(`"${key}":true`);
    }
  }, 60_000);

  it('renders a windowed tree and filters broad searches across 20,000 leaves', async () => {
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
      `(async()=>{
        const v=${view};
        const m=JSON.parse(require('fs').readFileSync(${JSON.stringify(modelPath)},'utf8'));
        await new Promise(r=>setTimeout(r,30));
        let maxTask=0;
        const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())maxTask=Math.max(maxTask,entry.duration)});
        observer.observe({entryTypes:['longtask']});
        const started=performance.now();
        const wait=async()=>{await new Promise(r=>setTimeout(r,30));for(let i=0;i<100 && el.querySelector('.exnf-leaf-report').getAttribute('aria-busy')==='true';i++)await new Promise(r=>setTimeout(r,20));};
        await v.report.update(m);
        const el=v.contentEl;
        el.querySelector('.leaf-tree-item').click();
        await wait();
        const selected=el.querySelector('.leaf-details').textContent.includes('group-0');
        const search=el.querySelector('input[type=search]');
        search.value='group'; search.dispatchEvent(new Event('input'));
        await wait();
        const broad=el.querySelector('.leaf-stats').textContent;
        const domRows=el.querySelectorAll('.leaf-tree-item').length;
        const tree=el.querySelector('.leaf-tree');
        tree.scrollTop=tree.scrollHeight; tree.dispatchEvent(new Event('scroll'));
        const finalRows=el.querySelectorAll('.leaf-tree-item').length;
        const mode=el.querySelector('[aria-label="Tree view"]');
        mode.value='all'; mode.dispatchEvent(new Event('change'));
        const sort=el.querySelector('[aria-label="Sort siblings"]');
        sort.value='count'; sort.dispatchEvent(new Event('change'));
        search.value='folder-1'; search.dispatchEvent(new Event('input'));
        search.value='folder-19999'; search.dispatchEvent(new Event('input'));
        await wait();
        const filtered=el.querySelector('.leaf-stats').textContent;
        const hiddenSelection=el.querySelector('.leaf-details').textContent.includes('hidden by the current filters');
        observer.disconnect();
        return JSON.stringify({totalMs:performance.now()-started,maxTask,domRows,finalRows,broad,filtered,selected,hiddenSelection});
      })()`
    );
    expect(rendered).toContain('20,000 displayed');
    expect(rendered).toContain('1 displayed');
    expect(rendered).toContain('"selected":true');
    expect(rendered).toContain('"hiddenSelection":true');
    const domRows = /"domRows":(?<count>\d+)/u.exec(rendered)?.groups?.['count'];
    const finalRows = /"finalRows":(?<count>\d+)/u.exec(rendered)?.groups?.['count'];
    expect(Number(domRows)).toBeLessThanOrEqual(60);
    expect(Number(finalRows)).toBeLessThanOrEqual(60);

    await writeSandboxReport('leaf-report/performance.json', rendered);

    const match = /"maxTask":(?<duration>[\d.]+)/u.exec(rendered)?.groups?.['duration'];

    expect(Number(match)).toBeLessThanOrEqual(100);

    evaluate(`app.workspace.detachLeavesOfType('${VIEW_TYPE}')`);
  }, 60_000);
});
