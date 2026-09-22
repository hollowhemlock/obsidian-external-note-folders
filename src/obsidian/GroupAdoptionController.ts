import type { App } from 'obsidian';

// eslint-disable-next-line import-x/no-nodejs-modules -- Adapter uses pure path computation only.
import path from 'node:path';
import {
  Modal,
  Notice,
  parseYaml,
  TFile
} from 'obsidian';

import type {
  AdoptionNoteChoice,
  GroupAdoptionPlan
} from '../core/groupAdoption.ts';
import type { GroupAdoptionJournal } from '../storage/groupAdoptionJournal.ts';

import {
  buildExternalRepair,
  buildNoteRepair,
  repairBinding
} from '../core/folderRepair.ts';
import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import { buildGroupAdoptionPlan } from '../core/groupAdoption.ts';
import { normalizePathForIdentity } from '../core/pathPolicy.ts';
import { generateUnusedCanonicalUuid } from '../core/uuid.ts';
import { assertAuditRoots } from '../storage/auditPaths.ts';
import { scanAdoptionAudit } from '../storage/auditScan.ts';
import { writeMarkerToExistingUnmarkedFolder } from '../storage/boundExternalFolder.ts';
import {
  assertSafeNotePath,
  createGroupJournal,
  inspectGroupMarker,
  pendingGroupJournals,
  readGroupJournal,
  runGroupJournal,
  saveGroupJournal
} from '../storage/groupAdoptionJournal.ts';
import { buildJournalRootPath } from '../storage/journalPath.ts';
import { executeReconcilePlan } from '../storage/reconcileExecutor.ts';
import { GroupAdoptionModal } from './GroupAdoptionModal.ts';

export interface GroupAdoptionHost {
  changed: (folder: string, note: null | string) => void;
  mutate: (operation: () => Promise<void>) => Promise<void>;
  sequence: () => number;
  settings: () => { externalRootIgnorePatterns: string[]; externalRootPath: string };
}

const FRONTMATTER_PATTERN = /^\uFEFF?---\r?\n(?<yaml>(?:[^\n]*\n)*?)---[ \t]*(?:\r?\n|$)/u;

class PendingAdoptionError extends Error {
  public constructor(public readonly journal: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
class UnacknowledgedDescendantsError extends Error {
  public constructor(public readonly descendants: string[]) {
    super(`Additional descendant notes require acknowledgment before resuming:\n${descendants.join('\n')}`);
  }
}

export class GroupAdoptionController {
  private readonly dialogs = new Set<Modal>();
  private disposed = false;
  private readonly notices = new Set<Notice>();
  public constructor(private readonly app: App, private readonly pluginId: string, private readonly host: GroupAdoptionHost) {}
  public choices(): AdoptionNoteChoice[] {
    return this.app.vault.getMarkdownFiles().map((file) => ({
      aliases: this.app.metadataCache.getFileCache(file)?.frontmatter?.['aliases'] as unknown,
      path: file.path
    }));
  }

  public dismiss(dialog: Modal): void {
    this.dialogs.delete(dialog);
  }

  public dispose(): void {
    this.disposed = true;
    for (const dialog of this.dialogs) {
      if (dialog instanceof GroupAdoptionModal) {
        dialog.cancel();
      } else {
        dialog.close();
      }
    }
    for (const notice of this.notices) {
      notice.hide();
    }
    this.notices.clear();
    this.dialogs.clear();
  }

  public async execute(plan: GroupAdoptionPlan, content: null | string): Promise<void> {
    await this.host.mutate(async () => {
      if (this.disposed || plan.mutationSequence !== this.host.sequence()) {
        throw new Error('Plan is stale. Preview again.');
      }
      const snapshot = await this.scan();
      if (plan.sourcePath && await this.readNote(plan.sourcePath) !== content) {
        throw new Error('Note changed. Preview again.');
      }
      const fresh = plan.repair && plan.sourcePath
        ? buildNoteRepair(
          snapshot,
          plan.folderPath,
          { aliases: frontmatter(content ?? '')['aliases'], path: plan.sourcePath },
          this.host.sequence(),
          this.host.settings().externalRootIgnorePatterns
        )
        : buildGroupAdoptionPlan({
          folderPath: plan.folderPath,
          ignorePatterns: this.host.settings().externalRootIgnorePatterns,
          move: plan.sourcePath !== plan.notePath,
          mutationSequence: this.host.sequence(),
          note: plan.sourcePath ? { aliases: frontmatter(content ?? '')['aliases'], path: plan.sourcePath } : null,
          snapshot,
          uuid: plan.uuid
        });
      if (JSON.stringify(fresh) !== JSON.stringify(plan)) {
        throw new Error('Folder, settings, or note evidence changed. Preview again.');
      }
      await this.assertDestination(plan);
      if (this.isDisposed()) {
        throw new Error('Plugin unloaded before adoption.');
      }
      const file = await createGroupJournal(this.journalRoot(), plan, content);
      try {
        await this.executeJournal(file, false);
      } catch (error: unknown) {
        throw new PendingAdoptionError(file, error);
      }
    });
  }

  public async executeForDialog(plan: GroupAdoptionPlan, content: null | string): Promise<
    { journal: string; kind: 'pending'; message: string } | { kind: 'complete' } | { kind: 'retry'; message: string }
  > {
    try {
      await this.execute(plan, content);
      return { kind: 'complete' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof PendingAdoptionError) {
        const journal = await readGroupJournal(error.journal).catch(() => undefined);
        if (journal?.stage === 'complete') {
          return { kind: 'complete' };
        }
        return { journal: error.journal, kind: 'pending', message };
      }
      return { kind: 'retry', message };
    }
  }

  public externalRoot(): string {
    return this.host.settings().externalRootPath;
  }

  public open(folder: string): void {
    if (this.disposed) {
      return;
    }
    const dialog = new GroupAdoptionModal(this.app, this, folder);
    this.dialogs.add(dialog);
    dialog.open();
  }

  public async openNote(notePath: string): Promise<void> {
    if (this.disposed) {
      throw new Error('Plugin has unloaded.');
    }
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      throw new Error('Note no longer exists.');
    }
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  public async pending(): Promise<string[]> {
    return pendingGroupJournals(this.journalRoot());
  }

  public async preview(
    folder: string,
    source: null | string,
    move: boolean,
    signal: AbortSignal
  ): Promise<{ content: null | string; plan: GroupAdoptionPlan }> {
    const snapshot = await this.scan(signal);
    const content = source ? await this.readNote(source) : null;
    const plan = buildGroupAdoptionPlan({
      folderPath: folder,
      ignorePatterns: this.host.settings().externalRootIgnorePatterns,
      move,
      mutationSequence: this.host.sequence(),
      note: source ? { aliases: frontmatter(content ?? '')['aliases'], path: source } : null,
      snapshot,
      uuid: generateUnusedCanonicalUuid(new Set([...snapshot.notes.map((note) => note.uuid), ...snapshot.markers.map((marker) => marker.uuid)]))
    });
    await this.assertDestination(plan);
    return { content, plan };
  }

  public async repair(folder: string, direction: 'external' | 'note'): Promise<void> {
    const sequence = this.host.sequence();
    const snapshot = await this.scan();
    const binding = repairBinding(snapshot, folder);
    const content = await this.readNote(binding.note);
    const notePlan = direction === 'note'
      ? buildNoteRepair(
        snapshot,
        folder,
        { aliases: frontmatter(content)['aliases'], path: binding.note },
        sequence,
        this.host.settings().externalRootIgnorePatterns
      )
      : undefined;
    const externalPlan = direction === 'external'
      ? buildExternalRepair(snapshot, folder, sequence, this.host.settings().externalRootIgnorePatterns)
      : undefined;
    if (notePlan) {
      await this.assertDestination(notePlan);
    }
    if (this.disposed) {
      return;
    }
    const modal = new Modal(this.app);
    this.dialogs.add(modal);
    modal.onClose = (): void => {
      this.dismiss(modal);
    };
    modal.titleEl.setText(direction === 'note' ? 'Move note to match external folder' : 'Move external folder to match note');
    modal.contentEl.createEl('p', { text: `Vault: ${snapshot.vaultRoot}\nExternal root: ${snapshot.externalRoot}` });
    modal.contentEl.createEl('p', { text: `Note: ${binding.note}\nExternal folder: ${folder}` });
    modal.contentEl.createEl('p', {
      text: notePlan
        ? `Move only ${binding.note} to ${notePlan.notePath}. Links follow Obsidian settings; the previous name is retained as an alias when renamed.`
        : externalPlan?.markdownReport ?? ''
    });
    modal.contentEl.createEl('p', {
      text: notePlan ? 'The external folder and UUID remain unchanged.' : 'The entire external folder subtree moves. The note and UUID remain unchanged.'
    });
    const status = modal.contentEl.createEl('p');
    const confirm = modal.contentEl.createEl('button', { text: 'Confirm move' });
    if (notePlan?.descendants.length) {
      const label = modal.contentEl.createEl('label', { text: `Acknowledge descendant notes: ${notePlan.descendants.join(', ')}` });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      confirm.disabled = true;
      checkbox.onchange = (): void => {
        confirm.disabled = !checkbox.checked;
      };
    }
    // eslint-disable-next-line func-style -- Capture the controller for a dialog-local retry.
    const retry = (): void => {
      const button = modal.contentEl.createEl('button', { text: 'Retry checks' });
      button.onclick = (): void => {
        button.disabled = true;
        this.repair(folder, direction).then(() => {
          modal.close();
        }).catch((error: unknown) => {
          status.setText(String(error));
          button.disabled = false;
        });
      };
    };
    confirm.onclick = (): void => {
      confirm.disabled = true;
      const execute = async (): Promise<void> => {
        if (notePlan) {
          const result = await this.executeForDialog(notePlan, content);
          if (result.kind === 'complete') {
            modal.close();
            return;
          }
          status.setText(result.message);
          if (result.kind === 'retry') {
            retry();
          }
          if (result.kind === 'pending') {
            const recovery = modal.contentEl.createEl('button', { text: 'Inspect / resume operation' });
            recovery.onclick = (): void => {
              this.showRecovery(result.journal).catch((error: unknown) => {
                status.setText(String(error));
              });
            };
          }
          return;
        }
        if (!externalPlan) {
          return;
        }
        await this.host.mutate(async () => {
          if (this.disposed || sequence !== this.host.sequence()) {
            throw new Error('Plan is stale. Open a fresh preview.');
          }
          const fresh = buildExternalRepair(await this.scan(), folder, sequence, this.host.settings().externalRootIgnorePatterns);
          if (JSON.stringify(fresh.rows) !== JSON.stringify(externalPlan.rows) || await this.readNote(binding.note) !== content) {
            throw new Error('Evidence changed. Open a fresh preview.');
          }
          if (this.isDisposed()) {
            throw new Error('Plugin unloaded before repair.');
          }
          const result = await executeReconcilePlan({
            journalRootPath: buildJournalRootPath({ configDir: this.app.vault.configDir, pluginId: this.pluginId, vaultRootPath: this.roots().vault }),
            plan: fresh
          });
          this.host.changed(folder, binding.note);
          status.setText(
            `${result.succeeded ? 'Move complete.' : 'Move stopped. Inspect source and destination before further action.'} Journal: ${result.journalPath}`
          );
        });
      };
      execute().catch((error: unknown) => {
        status.setText(error instanceof Error ? error.message : String(error));
      });
    };
    modal.contentEl.createEl('button', { text: 'Close' }).onclick = (): void => {
      modal.close();
    };
    modal.open();
  }

  public async resume(file: string, acknowledgedDescendants: readonly string[] = []): Promise<void> {
    await this.host.mutate(async () => this.executeJournal(file, true, acknowledgedDescendants));
  }

  public async showRecovery(journalFile?: string): Promise<void> {
    const files = (await this.pending()).filter((file) => !journalFile || file === journalFile);
    if (!files.length) {
      new Notice('No pending folder adoptions.');
      return;
    }
    const modal = new Modal(this.app);
    modal.onClose = (): void => {
      this.dismiss(modal);
    };
    this.dialogs.add(modal);
    modal.contentEl.createEl('h2', { text: 'Resume folder adoption' });
    for (const file of files) {
      const journal = await readGroupJournal(file);
      const row = modal.contentEl.createDiv();
      row.createEl('p', { text: `${journal.plan.folderPath} → ${journal.plan.notePath}\nStage: ${journal.stage}. ${journal.error}\nJournal: ${file}` });
      const acknowledgment = row.createDiv();
      let descendants: string[] = [];
      let checkbox: HTMLInputElement | undefined;
      function acknowledgedDescendants(): readonly string[] {
        return checkbox?.checked ? descendants : [];
      }
      function showError(error: unknown): void {
        const cause = error instanceof Error && error.cause instanceof UnacknowledgedDescendantsError ? error.cause : error;
        if (cause instanceof UnacknowledgedDescendantsError) {
          descendants = cause.descendants;
          acknowledgment.empty();
          acknowledgment.createEl('p', {
            text: `Additional unassigned notes remain unchanged and cannot have separate nested bindings:\n${descendants.join('\n')}`
          });
          const label = acknowledgment.createEl('label');
          checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
          label.createSpan({ text: 'I acknowledge these additional descendant notes' });
        } else {
          row.createEl('p', { text: error instanceof Error ? error.message : String(error) });
        }
      }
      const button = row.createEl('button', { text: 'Resume' });
      button.onclick = (): void => {
        button.disabled = true;
        this.resume(file, acknowledgedDescendants()).then(() => {
          modal.close();
        }).catch((error: unknown) => {
          showError(error);
          button.disabled = false;
        });
      };
      if (journal.stage === 'move' && journal.attempted) {
        row.createEl('p', {
          text:
            'If the note has reached its intended destination, inspect and correct its links before verifying completion. This action never retries an uncertain rename.'
        });
        const verified = row.createEl('button', { text: 'I checked links — verify completion' });
        verified.onclick = (): void => {
          verified.disabled = true;
          this.host.mutate(async () => {
            const current = await readGroupJournal(file);
            if (!current.plan.sourcePath || await this.app.vault.adapter.exists(current.plan.sourcePath)) {
              throw new Error('Original note path still exists. Resolve the move manually first.');
            }
            const identity = getExnfFrontmatterValue(frontmatter(await this.readNote(current.plan.notePath)));
            if (identity.kind !== 'valid' || identity.uuid !== current.plan.uuid) {
              throw new Error('Destination identity does not match.');
            }
            await this.preflightResume(current, acknowledgedDescendants());
            current.stage = 'verify';
            current.attempted = false;
            await saveGroupJournal(file, current);
            await this.executeJournal(file);
          }).then(() => {
            modal.close();
          }).catch((error: unknown) => {
            showError(error);
            verified.disabled = false;
          });
        };
      }
    }
    modal.open();
  }

  public trackNotice(notice: Notice): void {
    if (this.disposed) {
      notice.hide();
    } else {
      this.notices.add(notice);
    }
  }

  private async assertDestination(plan: GroupAdoptionPlan): Promise<void> {
    if (plan.notePath.split('/').some((part) => part.startsWith('.'))) {
      throw new Error('Obsidian cannot manage a note in a hidden path. Choose an existing visible note and bind without moving.');
    }
    await assertSafeNotePath(plan.vaultRoot, plan.notePath);
    if (plan.sourcePath !== plan.notePath && await this.app.vault.adapter.exists(plan.notePath)) {
      throw new Error(`Destination exists: ${plan.notePath}`);
    }
  }

  private async executeJournal(file: string, resume = true, acknowledgedDescendants: readonly string[] = []): Promise<void> {
    const journal = await readGroupJournal(file);
    const plan = journal.plan;
    async function save(): Promise<void> {
      await saveGroupJournal(file, journal);
    }
    try {
      if (resume) {
        await this.preflightResume(journal, acknowledgedDescendants);
      }
      await runGroupJournal(journal, {
        marker: async () => {
          if (!await inspectGroupMarker(plan.externalRoot, plan.folderPath, plan.uuid)) {
            await writeMarkerToExistingUnmarkedFolder({ externalRootPath: plan.externalRoot, folderPath: plan.folderPath, uuid: plan.uuid });
          }
        },
        move: async (interrupted) => {
          if (!plan.sourcePath || plan.sourcePath === plan.notePath) {
            return;
          }
          if (!await inspectGroupMarker(plan.externalRoot, plan.folderPath, plan.uuid)) {
            throw new Error('Marker disappeared before the move.');
          }
          const source = this.app.vault.getAbstractFileByPath(plan.sourcePath);
          if (interrupted) {
            throw new Error('An interrupted rename may have updated links. Inspect both note paths and links; manual recovery is required.');
          }
          if (!(source instanceof TFile) || await this.app.vault.read(source) !== journal.preparedContent) {
            throw new Error('Source note changed before relocation.');
          }
          await this.assertDestination(plan);
          await this.parents(plan.notePath);
          await this.app.fileManager.renameFile(source, plan.notePath);
        },
        note: async () => {
          if (!await inspectGroupMarker(plan.externalRoot, plan.folderPath, plan.uuid)) {
            throw new Error('Marker disappeared before the note write.');
          }
          const location = plan.sourcePath ?? plan.notePath;
          await assertSafeNotePath(plan.vaultRoot, location);
          let note = this.app.vault.getAbstractFileByPath(location);
          if (!plan.sourcePath && !note) {
            await this.parents(location);
            note = await this.app.vault.create(location, `---\nexnf: ${plan.uuid}\n---\n`);
          }
          if (!(note instanceof TFile)) {
            throw new Error('Expected note is missing or replaced.');
          }
          const current = await this.app.vault.read(note);
          const prepared = isPreparedNoteContent(current, journal);
          if (current !== journal.sourceContent && !prepared) {
            throw new Error('Note changed since confirmation; manual recovery required.');
          }
          if (!prepared) {
            await this.app.fileManager.processFrontMatter(note, (metadata: Record<string, unknown>) => {
              const value = getExnfFrontmatterValue(metadata);
              if (value.kind === 'invalid' || (value.kind === 'valid' && value.uuid !== plan.uuid)) {
                throw new Error('Note identity changed.');
              }
              metadata['exnf'] = plan.uuid;
              if (plan.aliases !== null) {
                metadata['aliases'] = plan.aliases;
              }
            });
          }
          const preparedContent = await this.app.vault.read(note);
          // eslint-disable-next-line require-atomic-updates -- The plugin mutation lock gives this executor sole ownership.
          journal.preparedContent = preparedContent;
        },
        verify: async () => {
          const metadata = frontmatter(await this.readNote(plan.notePath));
          const value = getExnfFrontmatterValue(metadata);
          if (value.kind !== 'valid' || value.uuid !== plan.uuid) {
            throw new Error('Final note identity does not match.');
          }
          if (plan.aliases !== null && JSON.stringify(metadata['aliases']) !== JSON.stringify(plan.aliases)) {
            throw new Error('Final note aliases changed.');
          }
          await this.preflightResume(journal);
          if (!await inspectGroupMarker(plan.externalRoot, plan.folderPath, plan.uuid)) {
            throw new Error('Marker is missing.');
          }
        }
      }, save);
      this.host.changed(plan.folderPath, plan.notePath);
      new Notice(`Adopted ${plan.folderPath}. Note: ${plan.notePath}`);
    } catch (error) {
      this.host.changed(plan.folderPath, null);
      throw new Error(`${error instanceof Error ? error.message : String(error)} Journal: ${file}. Use Resume folder adoption.`, { cause: error });
    }
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private journalRoot(): string {
    return path.join(
      buildJournalRootPath({ configDir: this.app.vault.configDir, pluginId: this.pluginId, vaultRootPath: this.roots().vault }),
      'group-adoption'
    );
  }

  private async parents(notePath: string): Promise<void> {
    const parts = notePath.split('/').slice(0, -1);
    let parent = '';
    for (const part of parts) {
      parent = parent ? `${parent}/${part}` : part;
      if (!await this.app.vault.adapter.exists(parent)) {
        await this.app.vault.createFolder(parent);
      }
    }
    await assertSafeNotePath(this.roots().vault, notePath);
  }

  private async preflightResume(journal: GroupAdoptionJournal, acknowledgedDescendants: readonly string[] = []): Promise<void> {
    const plan = journal.plan;
    const roots = this.roots();
    if (
      normalizePathForIdentity(roots.vault) !== normalizePathForIdentity(plan.vaultRoot)
      || normalizePathForIdentity(roots.external) !== normalizePathForIdentity(plan.externalRoot)
      || JSON.stringify(this.host.settings().externalRootIgnorePatterns) !== JSON.stringify(plan.ignorePatterns)
    ) {
      throw new Error('Roots or ignore settings changed; restore them before resuming.');
    }
    const scan = await this.scan();
    if (journal.sourceContent && getExnfFrontmatterValue(frontmatter(journal.sourceContent)).kind === 'valid' && scan.issues.some((issue) => issue.unchecked)) {
      throw new Error('Unchecked evidence prevents proving the existing UUID is unique.');
    }
    const beforeNoteWrite = journal.stage === 'marker' || journal.stage === 'note';
    const currentPath = plan.sourcePath && (beforeNoteWrite || this.app.vault.getAbstractFileByPath(plan.sourcePath)) ? plan.sourcePath : plan.notePath;
    // Exclude only this operation's own effects; all other evidence must pass the planner again.
    scan.markers = scan.markers.filter((marker) =>
      !(marker.uuid === plan.uuid && marker.markerPath === path.join(plan.folderPath, `${plan.uuid}.exnf`) && marker.status === 'valid')
    );
    const own = scan.notes.find((note) => note.relativePath === currentPath);
    if (own?.uuid === plan.uuid) {
      own.uuid = '';
      own.hasExnf = false;
      own.status = 'missing-property';
    }
    const content = this.app.vault.getAbstractFileByPath(currentPath) ? await this.readNote(currentPath) : null;
    if (beforeNoteWrite) {
      assertResumableNoteContent(content, journal);
    }
    if (currentPath !== plan.notePath || content === null) {
      await this.assertDestination(plan);
    } else {
      // A created or already-relocated note legitimately occupies the destination.
      await assertSafeNotePath(plan.vaultRoot, plan.notePath);
    }
    const fresh = buildGroupAdoptionPlan({
      folderPath: plan.folderPath,
      ignorePatterns: plan.ignorePatterns,
      move: currentPath !== plan.notePath,
      mutationSequence: this.host.sequence(),
      note: content === null ? null : { aliases: frontmatter(content)['aliases'], path: currentPath },
      snapshot: scan,
      uuid: plan.uuid
    });
    const additions = fresh.descendants.filter((descendant) => !plan.descendants.includes(descendant));
    if (additions.some((descendant) => !acknowledgedDescendants.includes(descendant))) {
      throw new UnacknowledgedDescendantsError(additions);
    }
    // The executor persists acknowledged scope with its next intent record, before effects.
    plan.descendants.push(...additions);
    plan.descendants.sort();
  }

  private async readNote(notePath: string): Promise<string> {
    await assertSafeNotePath(this.roots().vault, notePath);
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Note is unavailable: ${notePath}`);
    }

    return this.app.vault.read(file);
  }

  private roots(): { external: string; vault: string } {
    const vault = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
    const external = this.externalRoot();
    assertAuditRoots(vault, external);
    return { external, vault };
  }

  private async scan(signal?: AbortSignal): Promise<Awaited<ReturnType<typeof scanAdoptionAudit>>> {
    const roots = this.roots();
    return scanAdoptionAudit(roots.vault, roots.external, signal ? { signal } : {});
  }
}

function assertResumableNoteContent(content: null | string, journal: GroupAdoptionJournal): void {
  if (content !== journal.sourceContent && (content === null || !isPreparedNoteContent(content, journal))) {
    throw new Error('Note changed since confirmation; manual recovery required.');
  }
}

function frontmatter(content: string): Record<string, unknown> {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return {};
  }
  const value: unknown = parseYaml(match.groups?.['yaml'] ?? '');
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Frontmatter must be a YAML mapping.');
  }
  return value as Record<string, unknown>;
}

function isPreparedNoteContent(current: string, journal: GroupAdoptionJournal): boolean {
  const metadata = frontmatter(current);
  const identity = getExnfFrontmatterValue(metadata);
  return identity.kind === 'valid' && identity.uuid === journal.plan.uuid
    && (journal.plan.aliases === null || JSON.stringify(metadata['aliases']) === JSON.stringify(journal.plan.aliases))
    && matchesPreparedContent(current, journal);
}

function matchesPreparedContent(current: string, journal: GroupAdoptionJournal): boolean {
  if (journal.preparedContent !== null) {
    return current === journal.preparedContent;
  }
  if (journal.sourceContent === null) {
    return current === `---\nexnf: ${journal.plan.uuid}\n---\n`;
  }
  const before = frontmatter(journal.sourceContent);
  const after = frontmatter(current);
  delete before['exnf'];
  delete after['exnf'];
  if (journal.plan.aliases !== null) {
    delete before['aliases'];
    delete after['aliases'];
  }
  function body(text: string): string {
    return text.replace(FRONTMATTER_PATTERN, '').replace(/^\r?\n/u, '');
  }
  return JSON.stringify(before) === JSON.stringify(after) && body(current) === body(journal.sourceContent);
}
