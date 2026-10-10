import { execFileSync } from 'node:child_process';
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { buildAuditHtml } from '../../scripts/audit-html.ts';
import { buildLeafReport } from '../../src/core/leafReport.ts';
import { scanAdoptionAudit } from '../../src/storage/auditScan.ts';
import {
  closeSandboxModals,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxEval
} from './obsidianCliHarness.ts';

function evaluate(code: string): string {
  const result = runSandboxEval(code);
  expect(result.status, formatCliResult(result)).toBe(0);
  return result.stdout;
}

describe('scoped adoption and repository presentation', () => {
  it('resumes the same setup journal after restart and confirms changed omissions without rewriting its marker', async () => {
    const pluginId = await readSandboxPluginId();
    const name = `Scoped Setup ${String(Date.now())}`;
    const target = resolveRepoPath(`test/fixtures/sandbox/external-root/${name}`);
    await mkdir(path.join(target, 'build'), { recursive: true });
    execFileSync('git', ['init', '-q', path.dirname(target)]);
    execFileSync('git', ['init', '-q', target]);
    await writeFile(path.join(target, '.gitignore'), 'build/\n');
    await closeSandboxModals();
    try {
      const result = evaluate(`(async()=>{
        let p=app.plugins.plugins[${JSON.stringify(pluginId)}];const fs=require('fs'),path=require('path');
        const note=await app.vault.create(${JSON.stringify(name + '.md')},'Keep setup content.');
        const plan=await p.buildSetupPlanForFile(note);const root=p.getSetupJournalRootPath();
        const original=p.buildSetupExecutionOperations;
        try{p.buildSetupExecutionOperations=()=>({...original.call(p),writeNoteUuid:async()=>{throw Error('Sandbox interruption after marker');}});await p.runSetupExecuteCommand(plan);}finally{p.buildSetupExecutionOperations=original;}
        const file=fs.readdirSync(root).map(n=>path.join(root,n)).find(f=>JSON.parse(fs.readFileSync(f,'utf8')).notePath===note.path);
        const before=JSON.parse(fs.readFileSync(file,'utf8'));const marker=path.join(plan.targetPath,plan.uuid+'.exnf');
        fs.writeFileSync(marker,'Preserve these marker bytes');
        fs.mkdirSync(path.join(plan.targetPath,'dist'));fs.writeFileSync(path.join(plan.targetPath,'.gitignore'),'build/\\ndist/\\n');
        await app.plugins.disablePlugin(${JSON.stringify(pluginId)});await app.plugins.enablePlugin(${JSON.stringify(pluginId)});
        p=app.plugins.plugins[${JSON.stringify(pluginId)}];const open=p.openExternalFolder;p.openExternalFolder=async()=>{};
        try{
          await p.runSetupResumeCommand({...JSON.parse(fs.readFileSync(file,'utf8')),journalPath:file});
          const modal=Array.from(document.querySelectorAll('.modal')).at(-1);
          const updated=modal.textContent.includes('dist')&&modal.textContent.includes(plan.uuid);
          const confirm=Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='Confirm updated checks and resume');
          confirm.click();for(let i=0;i<300&&p.isMutationInProgress;i++)await new Promise(r=>setTimeout(r,30));
          const after=JSON.parse(fs.readFileSync(file,'utf8'));
          return JSON.stringify({updated,pending:before.stage==='frontmatter-write'&&!before.completedAt,complete:!!after.completedAt,same:before.runId===after.runId&&before.uuid===after.uuid,unchanged:fs.readFileSync(marker,'utf8')==='Preserve these marker bytes',content:(await app.vault.adapter.read(note.path)).includes('Keep setup content.')});
        }finally{p.openExternalFolder=open;}
      })()`);
      for (const key of ['updated', 'pending', 'complete', 'same', 'unchanged', 'content']) {
        expect(result).toContain(`"${key}":true`);
      }
    } finally {
      await closeSandboxModals();
    }
  }, 60_000);

  it('offers each binding level, discloses omissions, and renders repository context in both hosts', async () => {
    const pluginId = await readSandboxPluginId();
    const name = `Scoped Project ${String(Date.now())}`;
    const external = resolveRepoPath('test/fixtures/sandbox/external-root');
    const vault = resolveRepoPath('test/fixtures/sandbox/vault-plugin-external-note-folders-sandbox');
    const outer = path.join(external, name);
    const repo = path.join(outer, 'repo');
    const inner = path.join(repo, 'src');
    execFileSync('git', ['init', '-q', external]);
    await mkdir(inner, { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(path.join(repo, '.gitignore'), 'build/\nwindows/flutter/ephemeral/\n');
    for (const child of ['build', 'windows/flutter/ephemeral']) {
      await mkdir(path.join(repo, child), { recursive: true });
      await writeFile(path.join(repo, child, 'fixture.exnf'), 'ignored');
    }
    await writeFile(path.join(inner, 'payload.txt'), 'Keep');
    await closeSandboxModals();
    try {
      const result = evaluate(`(async()=>{
        const p=app.plugins.plugins[${JSON.stringify(pluginId)}];const c=p.groupAdoption;
        for(const folder of ${JSON.stringify([outer, repo, inner])}) await c.preview(folder,null,false,new AbortController().signal);
        const note=await app.vault.create(${JSON.stringify(name + '.md')},'Keep the note body.');
        const setup=await p.buildSetupPlanForFile(note);
        c.open(${JSON.stringify(outer)});
        const m=Array.from(document.querySelectorAll('.exnf-group-adoption')).at(-1);
        const input=m.querySelector('input[type=search]');input.value=${JSON.stringify(name + '.md')};input.dispatchEvent(new Event('input'));
        const button=()=>Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='Confirm adoption');
        for(let i=0;i<300&&button().disabled;i++)await new Promise(r=>setTimeout(r,30));
        const disclosure=Array.from(m.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent.includes('Excluded from checks'));
        return JSON.stringify({setup:setup.action,enabled:!button().disabled,collapsed:!!disclosure&&!disclosure.open,provenance:disclosure?.textContent.includes('.gitignore'),noExclusionCheckbox:!disclosure?.querySelector('input[type=checkbox]')});
      })()`);
      expect(result).toContain('confirm-unmarked-adoption');
      for (const key of ['enabled', 'collapsed', 'provenance', 'noExclusionCheckbox']) expect(result).toContain(`"${key}":true`);
      await closeSandboxModals();
      const model = buildLeafReport(await scanAdoptionAudit(vault, external, { statusScanMode: 'filtered' }));
      const html = resolveRepoPath('tmp/scoped-adoption-offline.html');
      await mkdir(path.dirname(html), { recursive: true });
      await writeFile(html, await buildAuditHtml(model));
      const presentation = evaluate(`(async()=>{
        const p=app.plugins.plugins[${JSON.stringify(pluginId)}];await p.openLeafReport();
        const v=app.workspace.getLeavesOfType('external-note-folders-leaf-report')[0].view;
        const frame=document.createElement('iframe');document.body.append(frame);
        frame.srcdoc=require('fs').readFileSync(${JSON.stringify(html)},'utf8');
        const results=[];
        try{for(const getRoot of [()=>v.contentEl,()=>frame.contentDocument]){
          let root;for(let i=0;i<300;i++){root=getRoot();if(root?.querySelector('.leaf-tree-item'))break;await new Promise(r=>setTimeout(r,30));}
          const search=root.querySelector('input[type=search]');search.value=${JSON.stringify(name)};search.dispatchEvent(new Event('input',{bubbles:true}));
          await new Promise(r=>setTimeout(r,500));
          const row=Array.from(root.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(${JSON.stringify(path.join(name, 'repo') + ' —')}));
          const badge=!!row?.querySelector('.leaf-repository-badge');
          const child=Array.from(root.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(${
        JSON.stringify(path.join(name, 'repo', 'src') + ' —')
      }));
          child?.click();await new Promise(r=>setTimeout(r,200));
          const details=root.querySelector('.leaf-details');
          const link=Array.from(details?.querySelectorAll('button')??[]).find(b=>b.textContent==='repo');
          const context=details?.textContent.includes('Inside repository:')&&!!link;
          link?.click();await new Promise(r=>setTimeout(r,150));
          results.push({badge,context,selectedRepo:root.querySelector('.leaf-details h2')?.textContent==='repo',hiddenMetadata:!Array.from(root.querySelectorAll('.leaf-tree-item')).some(r=>r.title.includes('\\\\.git —'))});
        }return JSON.stringify(results);}finally{frame.remove();}
      })()`);
      for (const key of ['badge', 'context', 'selectedRepo', 'hiddenMetadata']) {
        expect(presentation.match(new RegExp(`"${key}":true`, 'gu')), presentation).toHaveLength(2);
      }
      const created = evaluate(`(async()=>{
        const p=app.plugins.plugins[${JSON.stringify(pluginId)}];const c=p.groupAdoption;
        const x=await c.preview(${JSON.stringify(outer)},${JSON.stringify(name + '.md')},false,new AbortController().signal);
        await c.execute(x.plan,x.content);return x.plan.uuid;
      })()`);
      const markers = (await readdir(outer)).filter((entry) => entry.endsWith('.exnf'));
      expect(markers).toHaveLength(1);
      expect(created).toContain(markers[0]!.replace('.exnf', ''));
      expect(await readFile(path.join(vault, `${name}.md`), 'utf8')).toContain('Keep the note body.');
      expect(await readFile(path.join(inner, 'payload.txt'), 'utf8')).toBe('Keep');
    } finally {
      await closeSandboxModals();
      evaluate('app.workspace.detachLeavesOfType(\'external-note-folders-leaf-report\')');
    }
  }, 120_000);
});
