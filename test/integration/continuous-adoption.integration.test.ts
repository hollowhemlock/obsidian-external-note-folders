import { execFileSync } from 'node:child_process';
import {
  describe,
  expect,
  it
} from 'vitest';
import {
  closeSandboxModals,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxEval
} from './obsidianCliHarness.ts';

describe('continuous adoption in the shared report', () => {
  it('suggests notes, confirms successive adoptions, and updates both reports without refreshing', async () => {
    execFileSync('git', ['init', '-q', resolveRepoPath('test/fixtures/sandbox/external-root')], { windowsHide: true });
    await closeSandboxModals();
    const id = await readSandboxPluginId();
    const result = runSandboxEval(`(async()=>{
      const p=app.plugins.plugins[${JSON.stringify(id)}],fs=require('fs'),path=require('path');
      const contents=require('electron').remote.getCurrentWebContents();const throttled=contents.getBackgroundThrottling();contents.setBackgroundThrottling(false);
      const suffix=Date.now().toString(), parent='Continuous'+suffix;
      const folder=path.join(p.settings.externalRootPath,parent);fs.mkdirSync(folder);
      const names=['One'+suffix,'Two'+suffix];await app.vault.createFolder(parent);
      for(const name of names){fs.mkdirSync(path.join(folder,name));await app.vault.create(parent+'/'+name+'.md','Keep '+name);}
      await app.vault.createFolder(parent+'/Blocked');
      await app.vault.create(parent+'/Blocked/'+names[0]+'.md','---\\nexnf: invalid\\n---\\nKeep blocked candidate');
      const pause=()=>new Promise(r=>setTimeout(r,30));
      const wait=async(test)=>{for(let i=0;i<500;i++){if(test())return;await pause();}throw Error('Timed out waiting for continuous adoption UI');};
      let view,second;
      try {
        await p.openLeafReport();view=app.workspace.getLeavesOfType('external-note-folders-leaf-report')[0].view;
        const session=view.session;await session.refresh();const scanned=session.model.finishedAt;
        second=app.workspace.getLeaf('tab');await second.setViewState({type:'external-note-folders-leaf-report',active:false});
        const other=second.view;await wait(()=>!!other.session?.model);await other.session.refresh('unfiltered');
        const root=view.contentEl;
        const findButton=text=>Array.from(root.querySelectorAll('button')).find(b=>b.textContent===text);
        const row=name=>Array.from(root.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(path.join(parent,name)));
        const filter=root.querySelector('input[type=search]');filter.value=parent;filter.dispatchEvent(new Event('input'));
        findButton('Adoptable leaves').click();await wait(()=>!root.querySelector('[aria-busy=true]'));
        const counts=[],reveals=[];let optional=true;const scan=session.host.scan;session.host.scan=async()=>{throw Error('Unexpected full refresh');};
        try {
          for(const name of names){
            row(name).click();
            const target=path.join(folder,name);p.groupAdoption.open(target,view.knownMarkerPaths());
            const modal=Array.from(document.querySelectorAll('.exnf-group-adoption')).at(-1);
            const button=()=>Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='Confirm adoption');
            await wait(()=>!button().disabled);
            if(modal.querySelector('input[type=search]').value!==parent+'/'+name+'.md')throw Error('Suggestion not selected');
            if(modal.querySelector('[role=listbox]').hidden)throw Error('Suggestions hidden');
            if(name===names[0]&&!modal.querySelector('[role=listbox]').textContent.includes('Invalid external folder identifier'))throw Error('Blocked suggestion reason missing');
            if(fs.readdirSync(target).length)throw Error('Suggestion wrote before confirmation');
            button().click();await wait(()=>!modal.isConnected);
            const node=session.model.tree.find(n=>n.folderPath===target);
            counts.push(node.evidence.yaml==='present'&&node.evidence.marker==='present'&&node.evidence.status==='Bound at expected path');
            reveals.push(row(name)?.getAttribute('aria-selected')==='true'&&row(name)?.dataset.tone==='healthy');
            if(name===names[0])optional=row(names[1])?.dataset.tone==='optional';
          }
        } finally {session.host.scan=scan;}
        findButton('All folders').click();
        await wait(()=>!root.querySelector('[aria-busy=true]'));
        const working=session.model, otherModel=other.session.model;
        const rawUnchanged=!session.snapshot.notes.some(n=>n.relativePath===parent+'/'+names[1]+'.md'&&n.uuid);
        const fresh=working.tree.filter(n=>names.some(name=>n.folderPath===path.join(folder,name)));
        const colors=Array.from(root.querySelectorAll('[data-tone=healthy]')).length>=2;
        const ancestor=working.tree.find(n=>n.folderPath===folder);
        row('').click();await pause();
        const wording=root.querySelector('.leaf-details').textContent.includes('Binding changed in 2 subfolders')&&!root.querySelector('.leaf-details').textContent.includes('Binding changed this session.');
        const retryName='Retry'+suffix,retryFolder=path.join(p.settings.externalRootPath,retryName);fs.mkdirSync(retryFolder);
        const preview=await p.groupAdoption.preview(retryFolder,null,false,new AbortController().signal,view.knownMarkerPaths());
        const update=session.host.update;session.host.update=async()=>{throw Error('Injected render failure');};
        try{await p.groupAdoption.execute(preview.plan,preview.content);}finally{session.host.update=update;}
        const completedFailure=root.textContent.includes('Adoption completed; status update needs verification')&&!(await p.groupAdoption.pending()).some(file=>JSON.parse(fs.readFileSync(file,'utf8')).plan.folderPath===retryFolder);
        findButton('Retry status verification').click();await wait(()=>!findButton('Retry status verification'));
        const retry=session.workingSnapshot.markers.some(m=>m.uuid===preview.plan.uuid);
        return JSON.stringify({revealed:reveals.every(Boolean),optional,wording,completedFailure,retry,identities:counts.every(Boolean),rawUnchanged,colors,ancestor:ancestor.evidence.status!=='Bound at expected path',timestamp:working.finishedAt===scanned,history:working.verifiedChanges.length===2,other:otherModel.statusScanMode==='unfiltered'&&otherModel.verifiedChanges.length===2,known:fresh.every(n=>view.knownMarkerPaths().some(m=>path.dirname(m)===n.folderPath))});
      } finally {second?.detach();view?.leaf.detach();contents.setBackgroundThrottling(throttled);}
    })()`);
    expect(result.status, formatCliResult(result)).toBe(0);
    for (
      const key of [
        'revealed',
        'optional',
        'wording',
        'completedFailure',
        'retry',
        'identities',
        'rawUnchanged',
        'colors',
        'ancestor',
        'timestamp',
        'history',
        'other',
        'known'
      ]
    ) {
      expect(result.stdout, formatCliResult(result)).toContain(`"${key}":true`);
    }
  }, 90_000);
});
