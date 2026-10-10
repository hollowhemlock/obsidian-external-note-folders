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

import { buildAuditHtml } from '../../scripts/audit-html.ts';
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

function focusSandboxForKeyboardChecks(): void {
  const result = evaluate(`(async()=>{
    const win=require('electron').remote.getCurrentWindow();
    win.focus();
    for(let i=0;i<20&&!document.hasFocus();i++)await new Promise(r=>setTimeout(r,50));
    return document.hasFocus()?'SANDBOX_FOCUSED':'SANDBOX_NOT_FOCUSED';
  })()`);
  expect(result).toContain('SANDBOX_FOCUSED');
}

describe('shared leaf report integration', () => {
  beforeEach(async () => {
    await closeSandboxModals();
  });
  afterEach(async () => {
    await closeSandboxModals();
    evaluate(`app.workspace.detachLeavesOfType('${VIEW_TYPE}')`);
  });
  it('shows healthy bindings through filtered and full scan gaps in the tab and offline HTML', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
    const fixture = auditFixture();
    fixture.statusScanMode = 'filtered';
    for (
      const [relative, note, uuid] of [
        ['deck', 'deck/deck.md', '11111111-1111-4111-8111-111111111111'],
        ['Drift', 'Elsewhere.md', '22222222-2222-4222-8222-222222222222'],
        ['Nested', 'Nested.md', '33333333-3333-4333-8333-333333333333'],
        ['Nested/content/Child', 'Nested/content/Child.md', '44444444-4444-4444-8444-444444444444']
      ]
    ) {
      const folderPath = path.join(fixture.externalRoot, relative!);
      fixture.folders.push(folderPath);
      fixture.notes.push({ hasExnf: true, notePath: path.join(fixture.vaultRoot, note!), relativePath: note!, status: 'valid', uuid: uuid!, value: uuid! });
      fixture.markers.push({ folderPath, format: 'uuid-named', markerPath: path.join(folderPath, `${uuid}.exnf`), status: 'valid', uuid: uuid! });
      fixture.vault.bindings.set(uuid!, note!);
      fixture.external.bindings.set(uuid!, folderPath);
    }
    fixture.folders.push(path.join(fixture.externalRoot, 'deck/content'));
    for (const relative of ['deck/.git', 'deck/lib/vendor']) {
      const folderPath = path.join(fixture.externalRoot, relative);
      fixture.external.ignoredDirectories.push({ folderPath, relativePath: relative });
      fixture.issues.push({
        kind: 'directory',
        exclusionSource: 'git',
        scope: 'external',
        location: folderPath,
        reason: 'Git rule .gitignore:2: vendor/',
        unchecked: true
      });
    }
    const filtered = buildLeafReport(fixture);
    fixture.statusScanMode = 'unfiltered';
    fixture.issues = [];
    fixture.external.ignoredDirectories = [];
    for (let i = 0; i < 803; i++) {
      fixture.issues.push({
        kind: 'link',
        scope: 'external',
        location: path.join(fixture.externalRoot, `dependencies/link-${i}`),
        reason: 'Link not followed',
        unchecked: true
      });
    }
    for (let i = 0; i < 14; i++) {
      fixture.issues.push({
        kind: 'directory',
        scope: 'external',
        location: path.join(fixture.externalRoot, `temporary/unreadable-${i}`),
        reason: 'Directory could not be fully read',
        unchecked: true
      });
    }
    const unfiltered = buildLeafReport(fixture);
    const folderPath = path.join(fixture.externalRoot, 'deck');
    fixture.markers.push({ folderPath, format: 'legacy', markerPath: path.join(folderPath, '.exnf'), status: 'unchecked-marker', uuid: '' });
    fixture.issues.push({ kind: 'marker', scope: 'external', location: path.join(folderPath, '.exnf'), reason: 'Local identity unreadable', unchecked: true });
    const unreadable = buildLeafReport(fixture);
    const modelPath = resolveRepoPath('tmp/binding-health-models.json');
    const htmlPath = resolveRepoPath('tmp/binding-health-report.html');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(modelPath, JSON.stringify({ filtered, unfiltered, unreadable }));
    await writeFile(htmlPath, await buildAuditHtml(filtered));
    const result = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const models=JSON.parse(require('fs').readFileSync(${JSON.stringify(modelPath)},'utf8'));
      const el=v.contentEl;
      const row=(name)=>Array.from(el.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(name+' —'));
      const button=(label)=>Array.from(el.querySelectorAll('button')).find(b=>b.textContent===label);
      const wait=async()=>{await new Promise(r=>setTimeout(r,80));for(let i=0;i<200 && el.querySelector('.exnf-leaf-report').getAttribute('aria-busy')==='true';i++)await new Promise(r=>setTimeout(r,20));};
      await v.report.update(models.filtered);row('deck').click();await wait();
      const details=()=>el.querySelector('.leaf-details');
      const filtered=row('deck').dataset.tone==='healthy' && details().textContent.includes('Already bound; adoption is not needed.') && !details().textContent.includes('provisional');
      const restricted=!details().querySelector('[data-section=adoption]').open && button('Adopt this folder…').disabled;
      const neutral=el.querySelector('.leaf-scan-problems').hidden && el.querySelector('.leaf-coverage-notice').textContent.includes('Ignored folders are skipped');
      const exclusions=el.querySelector('[data-scan-category=exclusions]');
      const grouped=!exclusions.open && exclusions.textContent.includes('Git rule .gitignore:2: vendor/');
      await v.report.update(models.unfiltered);await wait();
      const full=row('deck').dataset.tone==='healthy' && !el.querySelector('.leaf-coverage-notice').textContent.includes('Ignored folders') && el.querySelector('.leaf-scan-problems').textContent.includes('14 unreadable directories');
      const links=el.querySelector('[data-scan-category=links]');
      const paged=!links.open && links.querySelectorAll('p').length===50 && links.querySelector('summary').textContent.includes('803');
      links.querySelector('button').click();const nextPage=links.querySelectorAll('p').length===100;
      button('View scan problems').click();await wait();
      const problems=el.querySelector('[data-scan-category=problems]');
      const focused=problems.open && document.activeElement===problems.querySelector('summary') && !links.open;
      const conflicts=row('Nested').dataset.tone==='conflict' && row('Drift').dataset.tone==='review';
      button('Needs review').click();await wait();const review=!row('deck') && !!row('Drift') && !!row('Nested');
      button('Clear filters').click();await wait();
      await v.report.update(models.unreadable);await wait();
      const local=row('deck').dataset.tone==='review' && !details().textContent.includes('Already bound; adoption is not needed.');
      await v.report.update(models.filtered);await wait();
      const newDisclosure=!details().querySelector('[data-section=adoption]').open;
      const frame=document.createElement('iframe');frame.style.cssText='width:1200px;height:700px';el.append(frame);
      let offline=false;
      try {
        frame.srcdoc=require('fs').readFileSync(${JSON.stringify(htmlPath)},'utf8');
        for(let i=0;i<200;i++){
          const doc=frame.contentDocument;
          const deck=Array.from(doc?.querySelectorAll('.leaf-tree-item')??[]).find(r=>r.title.startsWith('deck —'));
          if(deck){offline=deck.dataset.tone==='healthy' && doc.querySelector('.leaf-coverage-notice').textContent.includes('Additional .exnf markers') && doc.querySelector('.leaf-scan-problems').hidden;break;}
          await new Promise(r=>setTimeout(r,25));
        }
      } finally {frame.remove();}
      return JSON.stringify({filtered,restricted,neutral,grouped,full,paged,nextPage,focused,conflicts,review,local,newDisclosure,offline});
    })()`);
    for (
      const key of [
        'filtered',
        'restricted',
        'neutral',
        'grouped',
        'full',
        'paged',
        'nextPage',
        'focused',
        'conflicts',
        'review',
        'local',
        'newDisclosure',
        'offline'
      ]
    ) {
      expect(result).toContain(`"${key}":true`);
    }
  }, 60_000);
  it('publishes skipped repository warnings with separate coverage counts', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
    const state = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const scan=v.session.host.scan;
      const before=v.session.snapshot;
      const next={...before,issues:[...before.issues,{
        code:'git-repository-unavailable',kind:'directory',scope:'external',unchecked:true,
        location:before.externalRoot+'/broken-repository',
        reason:'Skipped repository: Git could not validate its metadata. Fixture diagnostic.'
      }]};
      try {
        v.session.host.scan=async()=>next;
        await v.session.refresh();
        return JSON.stringify({
          published:v.session.snapshot===next,
          warning:v.contentEl.textContent.includes('Scan complete with warnings.'),
          count:v.contentEl.querySelector('[data-metric=skippedRepositories] dd').textContent==='1',
          diagnostic:v.contentEl.textContent.includes('Fixture diagnostic.')
        });
      } finally {v.session.host.scan=scan;}
    })()`);
    expect(state).toContain('"published":true');
    expect(state).toContain('"warning":true');
    expect(state).toContain('"count":true');
    expect(state).toContain('"diagnostic":true');
  }, 60_000);

  it('separates scan and filter controls, metrics, feedback, and selectable text', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
    const state = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const el=v.contentEl;
      const root=el.querySelector('.exnf-leaf-report');
      const scan=el.querySelector('.leaf-scan-section');
      const filter=el.querySelector('.leaf-filter-section');
      const children=Array.from(root.children);
      const rootInfo=el.querySelector('.leaf-root-info');
      const button=(parent,label)=>Array.from(parent.querySelectorAll('button')).find(b=>b.textContent===label);
      const disclosure=(parent,label)=>Array.from(parent.querySelectorAll('details')).find(d=>d.querySelector('summary').textContent===label);
      const metrics=scan.querySelector('.leaf-scan-metrics').textContent;
      const outcome=scan.querySelector('.leaf-scan-status').textContent;
      const search=filter.querySelector('input[type=search]');
      search.value='no-such-fixture-folder';search.dispatchEvent(new Event('input'));
      for(let i=0;i<100 && filter.querySelector('[data-metric=matchingFolders] dd').textContent!=='0';i++)await new Promise(r=>setTimeout(r,20));
      v.report.status('Export cancelled.',false,'action');
      const passive=['.leaf-root-path','.leaf-scan-status','.leaf-scan-metrics dd','.leaf-filter-metrics dt','.leaf-legend','.leaf-tree-columns span'];
      const row=el.querySelector('.leaf-tree-item');
      return JSON.stringify({
        order:children.indexOf(rootInfo)<children.indexOf(scan) && children.indexOf(scan)<children.indexOf(filter),
        headings:scan.querySelector('h2').textContent==='Scan' && filter.querySelector('h2').textContent==='Filter',
        footer:scan.lastElementChild.classList.contains('leaf-scan-actions') && !!button(scan.lastElementChild,'Rescan excluding ignored folders'),
        exports:!!button(disclosure(scan,'Export scan'),'Export all unmarked leaves') && !!button(disclosure(filter,'Export filtered results'),'Export filtered unmarked leaves'),
        recovery:!!button(el.querySelector('.leaf-issue-controls'),'Resume folder adoption…') && !button(filter,'Resume folder adoption…'),
        stable:scan.querySelector('.leaf-scan-metrics').textContent===metrics && scan.querySelector('.leaf-scan-status').textContent===outcome,
        empty:filter.querySelector('[data-metric=matchingFolders] dd').textContent==='0',
        selectable:passive.every(s=>getComputedStyle(el.querySelector(s)).userSelect==='text'),
        interactive:getComputedStyle(button(rootInfo,'Inspect external root')).userSelect==='none' && (!row || getComputedStyle(row).userSelect==='none')
      });
    })()`);
    for (const key of ['order', 'headings', 'footer', 'exports', 'recovery', 'stable', 'empty', 'selectable', 'interactive']) {
      expect(state).toContain(`"${key}":true`);
    }
  }, 60_000);

  it('exposes both scan modes and retains the completed snapshot after a Git failure', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
    const state = evaluate(`(async()=>{
      const v=app.workspace.getLeavesOfType('${VIEW_TYPE}')[0].view;
      const buttons=Array.from(v.contentEl.querySelectorAll('button'));
      const filtered=buttons.find(b=>b.textContent==='Rescan excluding ignored folders');
      const full=buttons.find(b=>b.textContent==='Rescan entire external directory without filters');
      const initial=v.session.snapshot.statusScanMode;
      const scan=v.session.host.scan;
      let requested;
      let rejectScan;
      v.session.host.scan=options=>{requested=options.statusScanMode;return new Promise((_,reject)=>{rejectScan=reject;});};
      const before=v.session.snapshot;
      full.click();
      // Report actions start asynchronously; wait until the mock owns the pending scan.
      for(let i=0;i<100 && typeof rejectScan!=='function';i++)await new Promise(r=>setTimeout(r,20));
      if(typeof rejectScan!=='function') {
        v.session.host.scan=scan;
        throw new Error('Unfiltered rescan did not reach the mocked scanner.');
      }
      const busy=filtered.disabled && full.disabled;
      rejectScan(new Error('Git filtering failed for fixture'));
      for(let i=0;i<100 && full.disabled;i++)await new Promise(r=>setTimeout(r,20));
      const retained=v.session.snapshot===before;
      const message=v.contentEl.textContent.includes('Previous results retained');
      const errorText=v.contentEl.querySelector('.leaf-scan-error').textContent;
      const details=v.contentEl.querySelector('.leaf-failed-attempt').closest('details').open;
      let copied;
      let manualCopy;
      const write=navigator.clipboard.writeText;
      try {
        navigator.clipboard.writeText=async text=>{copied=text;};
        buttons.find(b=>b.textContent==='Copy error').click();
        for(let i=0;i<100 && !copied;i++)await new Promise(r=>setTimeout(r,20));
        navigator.clipboard.writeText=async()=>{throw new Error('Clipboard unavailable');};
        buttons.find(b=>b.textContent==='Copy error').click();
        for(let i=0;i<100 && !v.contentEl.textContent.includes('Could not copy.');i++)await new Promise(r=>setTimeout(r,20));
        manualCopy=v.contentEl.textContent.includes('Could not copy.')
          && getComputedStyle(v.contentEl.querySelector('.leaf-scan-error')).userSelect==='text'
          && v.contentEl.querySelector('.leaf-scan-error').textContent===errorText;
      } finally {navigator.clipboard.writeText=write;}
      v.session.host.scan=scan;
      await v.session.refresh('unfiltered');
      const cleared=v.contentEl.querySelector('.leaf-failed-attempt').hidden;
      return JSON.stringify({initial,requested,busy,retained,message,mode:v.session.snapshot.statusScanMode,
        details,copyMatches:copied===errorText,manualCopy,hasError:errorText.includes('Git filtering failed for fixture'),cleared});
    })()`);
    expect(state).toContain('"initial":"filtered"');
    expect(state).toContain('"requested":"unfiltered"');
    expect(state).toContain('"busy":true');
    expect(state).toContain('"retained":true');
    expect(state).toContain('"message":true');
    expect(state).toContain('"mode":"unfiltered"');
    expect(state).toContain('"details":true');
    expect(state).toContain('"copyMatches":true');
    expect(state).toContain('"manualCopy":true');
    expect(state).toContain('"hasError":true');
    expect(state).toContain('"cleared":true');
  }, 60_000);

  it('reuses one tab, preserves refresh results, exports and disposes', async () => {
    const pluginId = await readSandboxPluginId();

    const command = `${pluginId}:explore-unmarked-external-leaf-folders`;

    expect((await waitForPluginCommands(pluginId)).stdout).toContain(command);

    runSandboxCli(['command', `id=${command}`]);

    expect((await waitForSandboxModalText('Scan complete', REPORT_SELECTOR)).stdout).toContain('Filtered external scan');
    // The sandbox sits under a Git-ignored fixture directory. Inspect its full physical fixture explicitly.
    evaluate(
      `Array.from(document.querySelectorAll('${REPORT_SELECTOR} button')).find(b=>b.textContent==='Rescan entire external directory without filters').click()`
    );
    await waitForSandboxModalText('Unfiltered external scan', REPORT_SELECTOR);
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

    evaluate(`Array.from(${view}.contentEl.querySelectorAll('button')).find(b=>b.textContent==='Export all unmarked leaves').click()`);

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
    focusSandboxForKeyboardChecks();
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
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
      const selectWithoutExpand=branch.getAttribute('aria-selected')==='true' && branch.getAttribute('aria-expanded')==='false';
      branch.click();await wait();
      const expansionOrder=ordered() && branch.getAttribute('aria-expanded')==='true';
      tree.querySelector('.leaf-tree-item').click();await wait();
      branch.click();await wait();
      const selectWithoutCollapse=branch.getAttribute('aria-selected')==='true' && branch.getAttribute('aria-expanded')==='true';
      branch.click();await wait();
      const collapseSelected=branch.getAttribute('aria-expanded')==='false';
      const initial=tree.querySelector('.leaf-tree-item');initial.click();await wait();
      tree.scrollTop=80*28;tree.dispatchEvent(new Event('scroll'));
      const scrollFocus=document.activeElement===tree;
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
      const resumedKeyboard=document.activeElement.getAttribute('role')==='treeitem';
      const focusDiagnostic={active:document.activeElement.outerHTML.slice(0,300),inert:!!tree.closest('[inert]'),height:tree.clientHeight,scroll:tree.scrollTop};
      tree.focus();tree.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
      tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait();
      const paged=document.activeElement.textContent.includes('b-99');
      tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      const first=el.querySelector('.leaf-tree-item'); first.focus(); first.click(); await wait();
      const sort=el.querySelector('[aria-label="Sort siblings"]'); sort.value='count';sort.dispatchEvent(new Event('change'));await wait();
      const anchored=document.activeElement.textContent.includes('a-target') && tree.scrollTop>100*28;
      const sortOrder=ordered();
      const search=el.querySelector('input[type=search]'); search.value='b-0';search.dispatchEvent(new Event('input'));await wait();
      const hidden=el.querySelector('.leaf-details').textContent.includes('hidden by the current filters');
      search.value='';search.dispatchEvent(new Event('input'));await wait();
      const retained=el.querySelector('.leaf-details h2')?.textContent==='a-target';
      const before=el.querySelector('.leaf-filter-metrics').textContent;
      const abort=new AbortController();abort.abort();
      try{await v.report.update({...model,rows:[]},abort.signal)}catch{}
      const cancelled=el.querySelector('.leaf-filter-metrics').textContent===before;
      await v.report.update({...model,rows:model.rows.filter(r=>!r.relativePath.includes('a-target')),tree:model.tree.filter(n=>n.relativePath!=='a-target')});
      const removed=el.querySelector('.leaf-details').textContent.includes('Select a folder');
      tree.focus();tree.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      const keyboard=document.activeElement.getAttribute('role')==='treeitem';
      const report=el.querySelector('.exnf-leaf-report');
      report.style.width='600px';
      const layout=el.querySelector('.leaf-layout');
      const narrow=getComputedStyle(layout).gridTemplateColumns.split(' ').length===1;
      report.style.removeProperty('width');
      return JSON.stringify({focusDiagnostic,anchored,hidden,retained,cancelled,removed,keyboard,paged,narrow,selectWithoutExpand,selectWithoutCollapse,collapseSelected,expansionOrder,sortOrder,scrollFocus,resumedKeyboard,statusReset});
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
        'selectWithoutExpand',
        'selectWithoutCollapse',
        'collapseSelected',
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
    focusSandboxForKeyboardChecks();
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
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
      row('Project').click();await wait();
      row('Project'+String.fromCharCode(92)+'child').click();await wait();
      const relationship=details().textContent.includes('bound to Project.md') && details().textContent.includes('1 level above') && button('Adopt this folder…',details()).disabled;
      const expandedDetails=Array.from(details().querySelectorAll('details')).every(d=>d.open);
      const definitionsRemoved=!Array.from(details().querySelectorAll('p')).some(p=>/^(exact|yaml|marker): /.test(p.textContent));
      const boundStyle=getComputedStyle(row('Project'));
      const rowAttention=boundStyle.borderLeftWidth==='0px' && boundStyle.backgroundColor!==getComputedStyle(tree).backgroundColor && row('Project').dataset.tone==='healthy';
      const child=row('Project'+String.fromCharCode(92)+'child');
      const aligned=['.leaf-tree-count','.leaf-tree-descriptor','[data-evidence=exact]','[data-evidence=yaml]','[data-evidence=marker]'].every(selector=>row('Project').querySelector(selector).getBoundingClientRect().left===child.querySelector(selector).getBoundingClientRect().left);
      const columns=['exact','yaml','marker'].every((tag,i)=>{
        const heading=tree.querySelector('.leaf-tree-columns').children[i+3];
        const found=row('Project').querySelector('[data-evidence='+tag+']');
        const absent=child.querySelector('[data-evidence='+tag+']');
        return heading.textContent===tag && found.textContent===tag && absent.textContent==='' && absent.getAttribute('aria-label').includes('absent') && absent.title.length>0 && found.getBoundingClientRect().left===heading.getBoundingClientRect().left;
      });
      const compact=child.getBoundingClientRect().height===28 && row('Project').getBoundingClientRect().height===28;
      const selectedStyle=getComputedStyle(child);
      const selectionVisible=selectedStyle.boxShadow.includes('2px') && selectedStyle.color!==selectedStyle.backgroundColor;
      const originalTheme=document.body.className;
      let themePalette=true;
      try {
        for (const [theme,fill,ink,mark] of [
          ['light','rgb(208, 243, 208)','rgb(26, 26, 26)','#278733'],
          ['dark','rgb(39, 63, 40)','rgb(255, 255, 255)','#80CD82']
        ]) {
          document.body.classList.remove('theme-light','theme-dark');document.body.classList.add('theme-'+theme);
          const style=getComputedStyle(row('Project'));
          themePalette=themePalette && style.backgroundColor===fill && style.color===ink && style.getPropertyValue('--leaf-attention').trim()===mark;
          themePalette=themePalette && getComputedStyle(row('Project').querySelector('.leaf-evidence')).color===ink;
        }
      } finally { document.body.className=originalTheme; }
      const text=details().querySelector('.leaf-path-value');
      const range=document.createRange();range.selectNodeContents(text);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      const copyable=getComputedStyle(text).userSelect==='text' && selection.toString()===text.textContent;
      selection.removeAllRanges();
      const neutralChild=row('Project'+String.fromCharCode(92)+'child').dataset.tone==='neutral';
      const search=el.querySelector('input[type=search]');
      search.value='Other';search.dispatchEvent(new Event('input'));await wait();
      const stats=el.querySelector('.leaf-filter-metrics').textContent;
      const scroll=tree.scrollTop;
      button('Select marked ancestor',details()).click();await wait();
      const revealed=!!row('Project') && details().querySelector('h2').textContent==='Project' && document.activeElement===row('Project') && el.querySelector('.leaf-filter-metrics').textContent===stats;
      const sort=el.querySelector('[aria-label="Sort siblings"]');sort.value='count';sort.dispatchEvent(new Event('change'));await wait();
      const sorted=!!button('Back to selected folder',details());
      const abort=new AbortController();abort.abort();try{await v.report.update(model,abort.signal)}catch{}
      const cancelled=!!button('Back to selected folder',details());
      button('Back to selected folder',details()).click();await wait();
      const back=details().querySelector('h2').textContent.endsWith('child') && details().textContent.includes('hidden by the current filters') && !row('Project') && tree.scrollTop===scroll;
      button('Inspect external root').click();await wait();
      const root=details().querySelector('h2').textContent==='External root' && !button('Adopt this folder…',details()) && el.querySelector('.leaf-filter-metrics').textContent===stats;
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
      const menu=Array.from(el.querySelectorAll('.leaf-toolbar>details')).find(d=>d.querySelector('summary').textContent.startsWith('Advanced'));
      menu.querySelector('summary').click();menu.querySelector('select').focus();
      menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      const escape=!menu.open && document.activeElement===menu.querySelector('summary');
      menu.querySelector('summary').click();search.click();
      const outside=!menu.open;
      // Render captured uncertainty explicitly; blank cells must mean absence only.
      const warningModel=structuredClone(model), warningNode=warningModel.tree.find(n=>n.relativePath==='Other');
      warningNode.evidence.yaml='unchecked';warningNode.evidence.marker='invalid';
      await v.report.update(warningModel);
      const unchecked=row('Other').querySelector('[data-evidence=yaml]'), invalid=row('Other').querySelector('[data-evidence=marker]');
      const warnings=unchecked.textContent==='?' && unchecked.getAttribute('aria-label').includes('unchecked') && invalid.textContent==='⚠' && invalid.title.includes('malformed');
      return JSON.stringify({relationship,revealed,sorted,cancelled,back,root,selectionEnds,filterEnds,refreshEnds,escape,outside,expandedDetails,definitionsRemoved,rowAttention,aligned,columns,warnings,compact,selectionVisible,themePalette,copyable,neutralChild});
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
        'rowAttention',
        'aligned',
        'columns',
        'warnings',
        'compact',
        'selectionVisible',
        'themePalette',
        'copyable',
        'neutralChild'
      ]
    ) {
      expect(result).toContain(`"${key}":true`);
    }
  }, 60_000);

  it('shares review navigation, adoption availability, and stable resizable details', async () => {
    const pluginId = await readSandboxPluginId();
    runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);
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
      const filtered=el.querySelector('.leaf-filter-metrics').querySelector('[data-metric=matchingFolders] dd').textContent==='2';
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

    await waitForSandboxModalText('Scan complete', REPORT_SELECTOR);

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
        const exports=Array.from(el.querySelectorAll('.leaf-filter-section button')).filter(b=>b.textContent.startsWith('Export filtered'));
        search.value='group'; search.dispatchEvent(new Event('input'));
        const exportsPending=exports.length===2 && exports.every(b=>b.disabled);
        await wait();
        const exportsReady=exports.every(b=>!b.disabled);
        const broad=el.querySelector('[data-metric=matchingFolders] dd').textContent===(20100).toLocaleString();
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
        const filtered=el.querySelector('[data-metric=matchingFolders] dd').textContent==='1';
        const hiddenSelection=el.querySelector('.leaf-details').textContent.includes('hidden by the current filters');
        observer.disconnect();
        return JSON.stringify({totalMs:performance.now()-started,maxTask,domRows,finalRows,broad,filtered,selected,hiddenSelection,exportsPending,exportsReady});
      })()`
    );
    expect(rendered).toContain('"broad":true');
    expect(rendered).toContain('"filtered":true');
    expect(rendered).toContain('"selected":true');
    expect(rendered).toContain('"hiddenSelection":true');
    expect(rendered).toContain('"exportsPending":true');
    expect(rendered).toContain('"exportsReady":true');
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
