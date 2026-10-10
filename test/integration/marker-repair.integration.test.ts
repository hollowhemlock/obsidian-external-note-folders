import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { auditFixture } from '../support/auditFixture.ts';
import {
  closeSandboxModals,
  formatCliResult,
  readSandboxPluginId,
  resolveRepoPath,
  runSandboxCli,
  runSandboxEval,
  waitForSandboxModalText
} from './obsidianCliHarness.ts';

const VIEW = 'external-note-folders-leaf-report';
const REPORT = `.workspace-leaf-content[data-type="${VIEW}"]`;
const UUID = randomUUID();

function evaluate(code: string): string {
  const result = runSandboxEval(code);
  expect(result.status, formatCliResult(result)).toBe(0);
  return result.stdout;
}

describe('missing-marker repair integration', () => {
  it('shares previews across entry points and refreshes the confirmed status repair to healthy', async () => {
    const pluginId = await readSandboxPluginId();
    const name = `Marker Repair ${String(Date.now())}`;
    const note = `${name}.md`;
    const target = resolveRepoPath(`test/fixtures/sandbox/external-root/${name}`);
    const noteBytes = `---\nexnf: ${UUID}\n---\nKeep the note unchanged.\n`;
    // Give the sandbox its own Git context instead of inheriting the repository's sandbox exclusion.
    execFileSync('git', ['init', '-q', path.dirname(target)]);
    await mkdir(target);
    execFileSync('git', ['init', '-q', target]);
    await writeFile(path.join(target, '.gitignore'), 'references/\nnode_modules/\ndist/\n');
    for (const child of ['references', 'node_modules', 'dist']) {
      await mkdir(path.join(target, child));
      await writeFile(path.join(target, child, '123e4567-e89b-42d3-a456-426614174000.exnf'), 'ignored');
    }
    await writeFile(path.join(target, 'payload.txt'), 'keep');
    await closeSandboxModals();
    try {
      evaluate(
        `(async()=>{const f=await app.vault.create(${JSON.stringify(note)},${
          JSON.stringify(noteBytes)
        });await app.workspace.getLeaf(false).openFile(f);return true;})()`
      );
      for (const command of ['setup-external-folder', 'open-external-folder']) {
        runSandboxCli(['command', `id=${pluginId}:${command}`]);
        if (command === 'open-external-folder') {
          await waitForText('Create missing marker', '.modal');
          evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Create missing marker').click()`);
        }
        await waitForText('Intentional exclusions (4)', '.modal');
        const preview = evaluate(
          `(()=>{const m=Array.from(document.querySelectorAll('.modal')).find(e=>e.textContent.includes('Intentional exclusions (4)'));return JSON.stringify({enabled:!Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='Create marker').disabled,collapsed:!m.querySelector('details').open,noCheckbox:!m.querySelector('input[type=checkbox]'),identity:m.textContent.includes(${
            JSON.stringify(UUID)
          })});})()`
        );
        for (const key of ['enabled', 'collapsed', 'noCheckbox', 'identity']) {
          expect(preview).toContain(`"${key}":true`);
        }
        await closeSandboxModals();
        expect(await readdir(target)).not.toContain(`${UUID}.exnf`);
      }
      runSandboxCli(['command', `id=${pluginId}:explore-unmarked-external-leaf-folders`]);
      await waitForText('Scan complete', REPORT);
      evaluate(
        `(()=>{const v=app.workspace.getLeavesOfType('${VIEW}')[0].view;Array.from(v.contentEl.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(${
          JSON.stringify(name + ' —')
        })).click();return true;})()`
      );
      await waitForText('Create missing marker', REPORT);
      expect(
        evaluate(
          `(()=>{const e=document.querySelector('${REPORT}');const b=Array.from(e.querySelectorAll('button')).find(b=>b.textContent==='Create missing marker');const ok=!b.disabled&&!e.querySelector('.leaf-details').textContent.includes('adoption restrictions');b.click();return ok;})()`
        )
      ).toContain('true');
      await waitForText('Intentional exclusions (4)', '.modal');
      // Changing the active note after preview must not retarget the repair.
      evaluate(
        `(async()=>{await app.workspace.getLeaf(false).openFile(app.vault.getMarkdownFiles().find(f=>f.path!==${
          JSON.stringify(note)
        }));Array.from(document.querySelectorAll('.modal button')).find(b=>b.textContent==='Create marker').click();return true;})()`
      );
      await expect.poll(
        () =>
          evaluate(
            `(()=>{const v=app.workspace.getLeavesOfType('${VIEW}')[0].view;const r=Array.from(v.contentEl.querySelectorAll('.leaf-tree-item')).find(r=>r.title.startsWith(${
              JSON.stringify(name + ' —')
            }));return r?.dataset.tone;})()`
          ),
        { timeout: 30_000 }
      ).toContain('healthy');
      expect(await readFile(resolveRepoPath(`test/fixtures/sandbox/vault-plugin-external-note-folders-sandbox/${note}`), 'utf8')).toBe(noteBytes);
      expect(await readFile(path.join(target, 'payload.txt'), 'utf8')).toBe('keep');
      expect((await readdir(target)).filter((entry) => entry.endsWith('.exnf'))).toEqual([`${UUID}.exnf`]);

      const fixture = auditFixture();
      const folderPath = path.join(fixture.externalRoot, 'Repair');
      fixture.folders.push(folderPath);
      fixture.notes.push({
        hasExnf: true,
        notePath: path.join(fixture.vaultRoot, 'Repair.md'),
        relativePath: 'Repair.md',
        status: 'valid',
        uuid: UUID,
        value: UUID
      });
      fixture.vault.bindings.set(UUID, 'Repair.md');
      const html = resolveRepoPath('tmp/missing-marker-offline.html');
      await writeFile(html, await buildAuditHtml(buildLeafReport(fixture)));
      const offline = evaluate(
        `(async()=>{const frame=document.createElement('iframe');document.body.append(frame);try{frame.srcdoc=require('fs').readFileSync(${
          JSON.stringify(html)
        },'utf8');for(let i=0;i<200;i++){const doc=frame.contentDocument;const row=Array.from(doc?.querySelectorAll('.leaf-tree-item')??[]).find(r=>r.title.startsWith('Repair —'));if(row){row.click();await new Promise(r=>setTimeout(r,150));return doc.querySelector('.leaf-details').textContent.includes('This offline report cannot write markers.')&&!Array.from(doc.querySelectorAll('button')).some(b=>b.textContent==='Create missing marker');}await new Promise(r=>setTimeout(r,25));}return false;}finally{frame.remove();}})()`
      );
      expect(offline).toContain('true');
    } finally {
      await closeSandboxModals();
      evaluate(`app.workspace.detachLeavesOfType('${VIEW}')`);
    }
  }, 120_000);
});

async function waitForText(text: string, selector: string): Promise<void> {
  const result = await waitForSandboxModalText(text, selector);
  expect(result.stdout, formatCliResult(result)).toContain(text);
}
