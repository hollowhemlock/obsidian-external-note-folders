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
  runSandboxEval,
  waitForPluginCommands,
  waitForSandboxModalText,
  writeSandboxReport
} from './obsidianCliHarness.ts';

const VIEW_TYPE = 'external-note-folders-leaf-report';
const EXPORT_SELECTOR = '.modal:has(.external-note-folders-audit-destination)';
const REPORT_SELECTOR = '.workspace-leaf-content[data-type="external-note-folders-leaf-report"]';

function evaluate(code: string): string {
  const result = runSandboxEval(code);

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

    expect((await waitForSandboxModalText('Scan complete.', REPORT_SELECTOR)).stdout).toContain('Physical audit');
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
      const statusFilter=el.querySelector('[aria-label="Binding status"]');
      statusFilter.value='Unassigned folder';statusFilter.dispatchEvent(new Event('change'));await wait();
      const changedModel=JSON.parse(JSON.stringify(model));
      for(const node of changedModel.tree)node.evidence.status='Possible name matches';
      await v.report.update(changedModel);
      const statusReset=statusFilter.value==='' && tree.querySelector('.leaf-tree-item')!==null;
      await v.report.update(model);
      const branch=Array.from(tree.querySelectorAll('.leaf-tree-item')).find(row=>row.title.startsWith('b-0 —'));
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
      return JSON.stringify({anchored,hidden,retained,cancelled,removed,keyboard,paged,narrow,expansionOrder,sortOrder,scrollFocus,resumedKeyboard,statusReset});
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
        'resumedKeyboard',
        'statusReset'
      ]
    ) {
      expect(result).toContain(`"${key}":true`);
    }
  }, 60_000);

  it('reveals marked ancestors without changing filters, restores Back, and supports disclosure controls', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete.', REPORT_SELECTOR);
    const fixture = auditFixture();
    fixture.folders = ['Project', 'Project/child', 'Other'].map((name) => path.join(fixture.externalRoot, name));
    const folderPath = path.join(fixture.externalRoot, 'Project');
    const uuid = '11111111-1111-4111-8111-111111111111';
    fixture.markers.push({ folderPath, format: 'uuid-named', markerPath: path.join(folderPath, `${uuid}.exnf`), status: 'valid', uuid });
    fixture.notes.push({ hasExnf: true, notePath: path.join(fixture.vaultRoot, 'Project.md'), relativePath: 'Project.md', status: 'valid', uuid, value: uuid });
    const modelPath = resolveRepoPath('tmp/leaf-tree-navigation-model.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(modelPath, JSON.stringify(buildLeafReport(fixture)));
    const result = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const model=JSON.parse(require('fs').readFileSync(${JSON.stringify(modelPath)},'utf8'));
      await v.report.update(model);
      const el=v.contentEl;
      const tree=el.querySelector('.leaf-tree');
      const details=()=>el.querySelector('.leaf-details');
      const wait=async()=>{await new Promise(r=>setTimeout(r,60));for(let i=0;i<100 && el.querySelector('.exnf-leaf-report').getAttribute('aria-busy')==='true';i++)await new Promise(r=>setTimeout(r,20));};
      const button=(text,scope=el)=>Array.from(scope.querySelectorAll('button')).find(b=>b.textContent===text);
      const row=(name)=>Array.from(tree.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(name+' —'));
      row('Project').click();await wait();
      row('Project'+String.fromCharCode(92)+'child').click();await wait();
      const relationship=details().textContent.includes('bound to Project.md') && details().textContent.includes('1 level above') && button('Adopt this folder…',details()).disabled;
      const expandedDetails=Array.from(details().querySelectorAll('details')).every(d=>d.open);
      const definitionsRemoved=!Array.from(details().querySelectorAll('p')).some(p=>/^(exact|yaml|marker): /.test(p.textContent));
      const boundStyle=getComputedStyle(row('Project'));
      const leftAttention=boundStyle.borderLeftWidth==='8px' && boundStyle.borderRightWidth==='0px' && row('Project').dataset.tone==='healthy';
      const neutralChild=row('Project'+String.fromCharCode(92)+'child').dataset.tone==='neutral';
      const search=el.querySelector('input[type=search]');
      search.value='Other';search.dispatchEvent(new Event('input'));await wait();
      const stats=el.querySelector('.leaf-stats').textContent;
      const scroll=tree.scrollTop;
      button('Select marked ancestor',details()).click();await wait();
      const revealed=!!row('Project') && details().querySelector('h2').textContent==='Project' && document.activeElement===row('Project') && el.querySelector('.leaf-stats').textContent===stats;
      const sort=el.querySelector('[aria-label="Sort siblings"]');sort.value='count';sort.dispatchEvent(new Event('change'));await wait();
      const sorted=!!button('Back to selected folder',details());
      const abort=new AbortController();abort.abort();try{await v.report.update(model,abort.signal)}catch{}
      const cancelled=!!button('Back to selected folder',details());
      button('Back to selected folder',details()).click();await wait();
      const back=details().querySelector('h2').textContent.endsWith('child') && details().textContent.includes('hidden by the current filters') && !row('Project') && tree.scrollTop===scroll;
      button('Inspect external root').click();await wait();
      const root=details().querySelector('h2').textContent==='External root' && !button('Adopt this folder…',details()) && el.querySelector('.leaf-stats').textContent===stats;
      button('Back to selected folder',details()).click();await wait();
      button('Select marked ancestor',details()).click();await wait();
      row('Other').click();await wait();
      const selectionEnds=!button('Back to selected folder',details()) && !row('Project');
      button('Inspect external root').click();await wait();
      search.value='';search.dispatchEvent(new Event('input'));await wait();
      const filterEnds=!button('Back to selected folder',details());
      button('Inspect external root').click();await wait();
      await v.report.update(model);
      const refreshEnds=!button('Back to selected folder',details());
      const menu=Array.from(el.querySelectorAll('.leaf-toolbar>details')).find(d=>d.querySelector('summary').textContent==='View');
      menu.querySelector('summary').click();menu.querySelector('select').focus();
      menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      const escape=!menu.open && document.activeElement===menu.querySelector('summary');
      menu.querySelector('summary').click();search.click();
      const outside=!menu.open;
      return JSON.stringify({relationship,revealed,sorted,cancelled,back,root,selectionEnds,filterEnds,refreshEnds,escape,outside,expandedDetails,definitionsRemoved,leftAttention,neutralChild});
    })()`);
    for (
      const key of [
        'relationship',
        'revealed',
        'sorted',
        'cancelled',
        'back',
        'root',
        'selectionEnds',
        'filterEnds',
        'refreshEnds',
        'escape',
        'outside',
        'expandedDetails',
        'definitionsRemoved',
        'leftAttention',
        'neutralChild'
      ]
    ) {
      expect(result).toContain(`"${key}":true`);
    }
  }, 60_000);

  it('shares review navigation, adoption availability, and stable resizable details', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete.', REPORT_SELECTOR);
    const fixture = auditFixture(150);
    fixture.folders.push(
      ...['Branch', 'Branch/Child', 'ReviewParent', 'ReviewParent/A', 'ReviewParent/B'].map((name) => path.join(fixture.externalRoot, name))
    );
    const uuid = '11111111-1111-4111-8111-111111111111';
    const folderPath = path.join(fixture.externalRoot, 'ReviewParent/B');
    fixture.markers.push({ folderPath, format: 'uuid-named', markerPath: path.join(folderPath, `${uuid}.exnf`), status: 'valid', uuid });
    const invalidFolder = path.join(fixture.externalRoot, 'folder-120');
    fixture.markers.push({
      folderPath: invalidFolder,
      format: 'uuid-named',
      markerPath: path.join(invalidFolder, 'bad.exnf'),
      status: 'invalid-marker',
      uuid: ''
    });
    const model = buildLeafReport(fixture);
    const branch = model.tree!.find((node) => node.relativePath === 'Branch')!;
    branch.evidence!.explanations.push(...Array.from({ length: 30 }, (_, i) => `Diagnostic ${String(i)} for details scroll verification.`));
    const modelPath = resolveRepoPath('tmp/leaf-attention-model.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(modelPath, JSON.stringify(model));
    const result = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const model=JSON.parse(require('fs').readFileSync(${JSON.stringify(modelPath)},'utf8'));
      await v.report.update(model);
      const el=v.contentEl, root=el.querySelector('.exnf-leaf-report'), tree=el.querySelector('.leaf-tree');
      const details=()=>el.querySelector('.leaf-details');
      const button=(text,parent=el)=>Array.from(parent.querySelectorAll('button')).find(b=>b.textContent===text);
      const row=(name)=>Array.from(tree.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(name+' —'));
      const wait=async()=>{await new Promise(r=>setTimeout(r,60));for(let i=0;i<200 && root.getAttribute('aria-busy')==='true';i++)await new Promise(r=>setTimeout(r,20));};
      row('Branch').click();await wait();
      const blue=row('Branch').dataset.tone==='optional' && !button('Adopt this folder…',details()).disabled;
      // The captured availability still allows adoption until the scheduled query publishes.
      model.stale=true;row('Branch'+String.fromCharCode(92)+'Child').click();await wait();
      const staleGated=button('Adopt this folder…',details()).disabled;
      model.stale=false;row('Branch').click();await wait();
      details().querySelector('[data-section=notes]').open=false;
      details().scrollTop=160;
      const scroll=details().scrollTop;
      const copy=button('Copy path',details());copy.focus();
      const sort=el.querySelector('select[aria-label="Sort siblings"]');sort.value='count';sort.dispatchEvent(new Event('change'));await wait();
      const stable=copy===button('Copy path',details()) && document.activeElement===copy && !details().querySelector('[data-section=notes]').open && details().scrollTop===scroll;
      await v.report.update(structuredClone(model));await wait();
      const refreshed=document.activeElement===button('Copy path',details()) && !details().querySelector('[data-section=notes]').open && details().scrollTop===scroll;
      const divider=el.querySelector('[role=separator]'), layout=el.querySelector('.leaf-layout');
      divider.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));await wait();
      const minimum=divider.getAttribute('aria-valuenow')==='320';
      divider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));await wait();
      const maximum=divider.getAttribute('aria-valuenow')===divider.getAttribute('aria-valuemax');
      button('Reset pane width').click();await wait();
      const afterReset=layout.style.getPropertyValue('--leaf-tree-width');
      const expectedWidth=Math.max(320,Math.min(layout.clientWidth-24-320,(layout.clientWidth-24)*0.6));
      const reset=Math.abs(parseFloat(afterReset)-expectedWidth)<1;
      root.style.width='600px';await wait();const narrow=getComputedStyle(divider).display==='none';
      root.style.width='';await wait();const restored=getComputedStyle(divider).display!=='none';
      sort.value='name';sort.dispatchEvent(new Event('change'));await wait();
      button('Needs review').click();await wait();
      const filtered=el.querySelector('.leaf-stats').textContent.includes('2 displayed folders');
      button('Next issue').click();await wait();
      const first=details().querySelector('h2').textContent==='folder-120' && button('Previous issue').disabled;
      button('Next issue').click();await wait();
      const second=details().querySelector('h2').textContent==='B' && button('Next issue').disabled && row('ReviewParent').getAttribute('aria-expanded')==='true';
      const search=el.querySelector('input[type=search]');search.value='no-matches';search.dispatchEvent(new Event('input'));await wait();
      const empty=button('Previous issue').disabled && button('Next issue').disabled;
      button('Clear filters').click();await wait();
      const cleared=button('Needs review').getAttribute('aria-pressed')==='false';
      const parent=model.tree.find(n=>n.relativePath==='ReviewParent');
      const a=model.tree.find(n=>n.segments.at(-1)==='A');
      const b=model.tree.find(n=>n.segments.at(-1)==='B');
      v.report.adopted(a.folderPath,'A.md');v.report.adopted(b.folderPath,null);await wait();
      search.value='ReviewParent';search.dispatchEvent(new Event('input'));await wait();
      const pending=row('ReviewParent').dataset.tone==='conflict' && row('ReviewParent'+String.fromCharCode(92)+'B').dataset.tone==='conflict';
      const fresh=structuredClone(model);fresh.stale=false;await v.report.update(fresh);await wait();
      const retainedPending=row('ReviewParent').dataset.tone==='conflict';
      const aborted=new AbortController();aborted.abort();try{await v.report.update(model,aborted.signal);}catch{}
      const cancelled=row('ReviewParent').dataset.tone==='conflict';
      const answer={blue,staleGated,stable,refreshed,minimum,maximum,reset,narrow,restored,filtered,first,second,empty,cleared,pending,retainedPending,cancelled};
      return JSON.stringify(answer);
    })()`);
    for (
      const key of [
        'blue',
        'staleGated',
        'stable',
        'refreshed',
        'minimum',
        'maximum',
        'reset',
        'narrow',
        'restored',
        'filtered',
        'first',
        'second',
        'empty',
        'cleared',
        'pending',
        'retainedPending',
        'cancelled'
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
    expect(rendered).toContain('20100 displayed folders');
    expect(rendered).toContain('1 displayed folders');
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
