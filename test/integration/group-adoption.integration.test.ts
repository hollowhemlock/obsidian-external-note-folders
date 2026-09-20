import {
  describe,
  expect,
  it
} from 'vitest';
import { runObsidianCli } from '../../scripts/obsidian-cli.ts';
import { getCurrentSandboxPaths } from '../../scripts/sandbox-paths.ts';
import {
  closeSandboxModals,
  formatCliResult,
  readSandboxPluginId
} from './obsidianCliHarness.ts';

function evaluate(code: string): string {
  const result = runObsidianCli(['eval', `code=${code}`], getCurrentSandboxPaths().vaultPath, 30_000);
  expect(result.status, formatCliResult(result)).toBe(0);
  return result.stdout;
}
describe('folder group adoption in Obsidian', () => {
  it('previews and confirms both directions for an existing drifted binding', async () => {
    await closeSandboxModals();
    const id = await readSandboxPluginId();
    const result = evaluate(`(async()=>{
      const plugin=app.plugins.plugins[${JSON.stringify(id)}];const c=plugin.groupAdoption;
      const fs=require('fs');const path=require('path');const crypto=require('crypto');
      const outcomes=[];
      for(const direction of ['note','external']) {
        const suffix=Date.now().toString()+direction;const uuid=crypto.randomUUID();
        const oldName='RepairOld'+suffix;const folderName='RepairFolder'+suffix;
        const note=oldName+'.md';const folder=path.join(plugin.settings.externalRootPath,folderName);
        await app.vault.create(note,'---\\nexnf: '+uuid+'\\n---\\nPreserve body');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,uuid+'.exnf'),'');
        await c.repair(folder,direction);
        const modal=Array.from(document.querySelectorAll('.modal')).at(-1);
        const untouched=!!app.vault.getAbstractFileByPath(note)&&fs.existsSync(folder);
        Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='Confirm move').click();
        const target=direction==='note'?folderName+'.md':path.join(plugin.settings.externalRootPath,oldName);
        for(let i=0;i<200;i++){if(direction==='note'?!!app.vault.getAbstractFileByPath(target):fs.existsSync(target))break;await new Promise(r=>setTimeout(r,50));}
        const moved=direction==='note'?!!app.vault.getAbstractFileByPath(target):fs.existsSync(target);
        outcomes.push({direction,untouched,moved});
        for(let i=0;i<200&&plugin.isMutationInProgress;i++)await new Promise(r=>setTimeout(r,50));
        document.querySelectorAll('.modal-close-button').forEach(b=>b.click());
      }
      return JSON.stringify(outcomes);
    })()`);
    expect(result.match(/"untouched":true/gu), result).toHaveLength(2);
    expect(result.match(/"moved":true/gu), result).toHaveLength(2);
  }, 60_000);

  it('automatically previews input and modes with a permanent confirmation footer', async () => {
    await closeSandboxModals();
    const id = await readSandboxPluginId();
    const result = evaluate(`(async()=>{
      const plugin=app.plugins.plugins[${JSON.stringify(id)}];const c=plugin.groupAdoption;
      const fs=require('fs');const path=require('path');const suffix=Date.now().toString();
      const note='UnrelatedChoice'+suffix+'.md';await app.vault.create(note,'Keep unchanged.');
      const folder=path.join(plugin.settings.externalRootPath,'NoSuggestions'+suffix);fs.mkdirSync(folder);
      c.open(folder);const modal=Array.from(document.querySelectorAll('.exnf-group-adoption')).at(-1);
      const button=text=>Array.from(modal.querySelectorAll('button')).find(b=>b.textContent===text);
      const confirm=button('Confirm adoption');const input=modal.querySelector('input[type=search]');
      const wait=async()=>{for(let i=0;i<200 && confirm.disabled;i++)await new Promise(r=>setTimeout(r,50));};
      const initial=confirm.disabled && !button('Preview adoption') && button('Create new note').getAttribute('aria-checked')==='true';
      await wait();const automatic=!confirm.disabled && modal.querySelector('.exnf-adoption-footer').contains(confirm) && getComputedStyle(button('Retry checks')).display==='none' && getComputedStyle(button('Resume folder adoption…')).display==='none';
      input.value='missing-'+suffix;input.dispatchEvent(new Event('input'));
      const invalid=confirm.disabled && button('Open note').disabled && Array.from(modal.querySelectorAll('[role=radio]')).every(b=>b.disabled);
      input.value=note.slice(0,-3);input.dispatchEvent(new Event('input'));await wait();
      const resolved=!confirm.disabled && !button('Open note').disabled && button('Create new note').disabled;
      button('Move note to match folder').click();const invalidated=confirm.disabled;await wait();
      const moved=modal.textContent.includes('Bind and move the note') && button('Move note to match folder').getAttribute('aria-checked')==='true';
      input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      const noMutation=fs.readdirSync(folder).length===0;
      button('Clear').click();await wait();
      const cleared=input.value==='' && button('Create new note').getAttribute('aria-checked')==='true';
      const unchanged=(await app.vault.read(app.vault.getAbstractFileByPath(note)))==='Keep unchanged.';
      confirm.click();for(let i=0;i<200 && modal.isConnected;i++)await new Promise(r=>setTimeout(r,50));const created=!!app.vault.getAbstractFileByPath('NoSuggestions'+suffix+'.md') && fs.readdirSync(folder).some(n=>n.endsWith('.exnf'));return JSON.stringify({initial,automatic,invalid,resolved,invalidated,moved,noMutation,cleared,unchanged,created});
    })()`);
    for (const key of ['initial', 'automatic', 'invalid', 'resolved', 'invalidated', 'moved', 'noMutation', 'cleared', 'unchanged', 'created']) {
      expect(result).toContain(`"${key}":true`);
    }
  }, 60_000);
  it('opens candidate notes without adopting and restores the selected note on return', async () => {
    await closeSandboxModals();
    const id = await readSandboxPluginId();
    const result = evaluate(`(async()=>{
      const plugin=app.plugins.plugins[${JSON.stringify(id)}];const c=plugin.groupAdoption;
      const fs=require('fs');const path=require('path');const suffix=Date.now().toString();
      const name='Inspect'+suffix;const note='Candidate'+suffix+'.md';
      await app.vault.create(note,'---\\naliases: '+name+'\\n---\\nInspect only.');
      const folder=path.join(plugin.settings.externalRootPath,name);fs.mkdirSync(folder);
      await new Promise(r=>setTimeout(r,300));c.open(folder);
      let modal=Array.from(document.querySelectorAll('.exnf-group-adoption')).at(-1);
      const input=modal.querySelector('input[type=search]');input.value=note;input.dispatchEvent(new Event('input'));
      Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='Open note').click();
      await new Promise(r=>setTimeout(r,300));const opened=app.workspace.getActiveFile()?.path===note;
      Array.from(document.querySelectorAll('.notice button')).filter(b=>b.textContent==='Return to folder adoption').at(-1).click();
      modal=Array.from(document.querySelectorAll('.exnf-group-adoption')).at(-1);const preserved=modal.querySelector('input[type=search]').value===note;
      Array.from(c.dialogs).find(d=>d.contentEl===modal).close();
      return JSON.stringify({opened,preserved,unmarked:fs.readdirSync(folder).length===0,unchanged:!(await app.vault.read(app.vault.getAbstractFileByPath(note))).includes('exnf:')});
    })()`);
    expect(result).toContain('"opened":true');
    expect(result).toContain('"preserved":true');
    expect(result).toContain('"unmarked":true');
    expect(result).toContain('"unchanged":true');
  }, 60_000);

  it('creates a note and marker, then moves an existing note and preserves its alias and links', async () => {
    await closeSandboxModals();
    const id = await readSandboxPluginId();
    const result = evaluate(`(async()=>{
      const plugin=app.plugins.plugins[${JSON.stringify(id)}];const c=plugin.groupAdoption;
      const fs=require('fs');const path=require('path');const suffix=Date.now().toString();
      const relative='GroupAdoption'+suffix;const folder=path.join(plugin.settings.externalRootPath,relative);
      fs.mkdirSync(folder,{recursive:true});
      let preview=await c.preview(folder,null,false,new AbortController().signal);
      await c.execute(preview.plan,preview.content);
      const note=app.vault.getAbstractFileByPath(relative+'.md');
      const created=await app.vault.read(note);const marker=fs.existsSync(path.join(folder,preview.plan.uuid+'.exnf'));
      const old='OldName'+suffix+'.md';await app.vault.create(old,'---\\naliases: ExistingAlias\\n---\\nPreserve this body.');
      const link='Link'+suffix+'.md';await app.vault.create(link,'[['+old.slice(0,-3)+']]');
      await new Promise(r=>setTimeout(r,250));
      const moveFolder=path.join(plugin.settings.externalRootPath,'Moved'+suffix);fs.mkdirSync(moveFolder);
      preview=await c.preview(moveFolder,old,true,new AbortController().signal);
      const updateLinks=app.vault.getConfig('alwaysUpdateLinks');app.vault.setConfig('alwaysUpdateLinks',true);
      try{await c.execute(preview.plan,preview.content)}finally{app.vault.setConfig('alwaysUpdateLinks',updateLinks)}
      const moved=await app.vault.read(app.vault.getAbstractFileByPath('Moved'+suffix+'.md'));
      const linked=await app.vault.read(app.vault.getAbstractFileByPath(link));
      return JSON.stringify({marker,created:created.includes('exnf:'),moved:moved.includes('Preserve this body.'),alias:moved.includes('OldName'+suffix)&&moved.includes('ExistingAlias'),oldGone:!app.vault.getAbstractFileByPath(old),linksUpdated:linked.includes('Moved'+suffix),pending:(await c.pending()).length});
    })()`);
    expect(result).toContain('"marker":true');
    expect(result).toContain('"created":true');
    expect(result).toContain('"moved":true');
    expect(result).toContain('"alias":true');
    expect(result).toContain('"oldGone":true');
    expect(result).toContain('"linksUpdated":true');
  }, 60_000);

  it('keeps interrupted rename recovery available independently of report rows', async () => {
    const id = await readSandboxPluginId();
    const result = evaluate(`(async()=>{
      const plugin=app.plugins.plugins[${JSON.stringify(id)}];const c=plugin.groupAdoption;
      const fs=require('fs');const path=require('path');const suffix=Date.now().toString();
      const source='Interrupted'+suffix+'.md';await app.vault.create(source,'Keep me.');
      const folder=path.join(plugin.settings.externalRootPath,'InterruptedTarget'+suffix);fs.mkdirSync(folder);
      const preview=await c.preview(folder,source,true,new AbortController().signal);
      const rename=app.fileManager.renameFile;app.fileManager.renameFile=async function(...args){await rename.apply(this,args);throw new Error('Injected failure after rename');};
      let failed=false;try{await c.execute(preview.plan,preview.content)}catch{failed=true}finally{app.fileManager.renameFile=rename}
      const journals=await c.pending();const own=journals.find(p=>JSON.parse(fs.readFileSync(p,'utf8')).plan.folderPath===folder);
      let blocked=false;try{await c.executeJournal(own)}catch(e){blocked=String(e).includes('manual recovery')}
      return JSON.stringify({failed,pending:!!own,blocked,targetExists:!!app.vault.getAbstractFileByPath(preview.plan.notePath),command:!!app.commands.commands[${
      JSON.stringify(id + ':resume-folder-adoption')
    }]});
    })()`);
    expect(result).toContain('"failed":true');
    expect(result).toContain('"pending":true');
    expect(result).toContain('"blocked":true');
    expect(result).toContain('"targetExists":true');
    expect(result).toContain('"command":true');
  }, 60_000);

  it('resumes a failed note creation after plugin reload and rejects a changed note before writing', async () => {
    const id = await readSandboxPluginId();
    const result = evaluate(`(async()=>{
      const id=${JSON.stringify(id)};let plugin=app.plugins.plugins[id];let c=plugin.groupAdoption;
      const fs=require('fs');const path=require('path');const suffix=Date.now().toString();
      const folder=path.join(plugin.settings.externalRootPath,'ResumeCreate'+suffix);fs.mkdirSync(folder);
      const preview=await c.preview(folder,null,false,new AbortController().signal);
      const create=app.vault.create;app.vault.create=async function(){throw new Error('Injected note creation failure')};
      try{await c.execute(preview.plan,preview.content)}catch{}finally{app.vault.create=create}
      const own=(await c.pending()).find(p=>JSON.parse(fs.readFileSync(p,'utf8')).plan.folderPath===folder);
      await app.plugins.disablePlugin(id);await app.plugins.enablePlugin(id);plugin=app.plugins.plugins[id];c=plugin.groupAdoption;
      await c.executeJournal(own);const completed=JSON.parse(fs.readFileSync(own,'utf8')).stage==='complete';
      const note='Stale'+suffix+'.md';const file=await app.vault.create(note,'Original');
      const other=path.join(plugin.settings.externalRootPath,'StaleFolder'+suffix);fs.mkdirSync(other);
      const stale=await c.preview(other,note,false,new AbortController().signal);await app.vault.modify(file,'User changed it');
      let rejected=false;try{await c.execute(stale.plan,stale.content)}catch(e){rejected=String(e).includes('Note changed')}
      return JSON.stringify({completed,rejected,unmarked:fs.readdirSync(other).length===0,unchanged:(await app.vault.read(file))==='User changed it'});
    })()`);
    expect(result).toContain('"completed":true');
    expect(result).toContain('"rejected":true');
    expect(result).toContain('"unmarked":true');
    expect(result).toContain('"unchanged":true');
  }, 60_000);
});
