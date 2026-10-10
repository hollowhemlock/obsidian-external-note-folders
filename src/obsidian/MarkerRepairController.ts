import type { App } from 'obsidian';

import { Modal } from 'obsidian';

import type {
  MarkerRepairContext,
  MarkerRepairPlan
} from '../core/markerRepair.ts';
import type {
  SetupExecutionOperations,
  SetupJournal
} from '../storage/setupExecutor.ts';

import { buildExnfMarkerFileName } from '../core/marker.ts';
import {
  buildMarkerRepairPlan,
  sameMarkerRepairScope
} from '../core/markerRepair.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity as identity
} from '../core/pathPolicy.ts';
import { assertBindingNoteAllowed } from '../core/templateExclusions.ts';
import {
  resolveExternalRootPath,
  writeExpectedMarkerIfMissingOrMatching
} from '../storage/boundExternalFolder.ts';
import { inspectMarkerRepair } from '../storage/markerRepairInspection.ts';
import {
  executeSetupPlan,
  listIncompleteSetupJournals,
  readSetupJournal,
  resumeSetupJournal,
  updateMarkerRepairJournal
} from '../storage/setupExecutor.ts';
import {
  readMarkerRepairNote,
  readMarkerRepairNotes
} from './markerRepairVault.ts';

export interface MarkerRepairHost {
  assertNoPending: (folder: string, except?: string) => Promise<void>;
  changed: (folder: string, note: null | string) => void;
  journalRoot: () => string;
  knownFolders: (uuid: string) => string[];
  mutate: (operation: () => Promise<void>) => Promise<void>;
  openFolder: (folder: string) => Promise<void>;
  refresh: () => Promise<void>;
  sequence: () => number;
  settings: () => { externalRootIgnorePatterns: string[]; externalRootPath: string; templateExcludePatterns?: string[] };
}

export class MarkerRepairController {
  private readonly dialogs = new Set<Modal>();
  private disposed = false;
  public constructor(private readonly app: App, private readonly host: MarkerRepairHost) {}
  public async check(context: MarkerRepairContext, signal?: AbortSignal): Promise<MarkerRepairPlan> {
    if (this.disposed) {
      throw new Error('Plugin unloaded.');
    }
    const mutationSequence = this.host.sequence();
    assertBindingNoteAllowed(context.notePath, this.host.settings().templateExcludePatterns);
    const current = await this.context(context.notePath, context.targetPath, context.uuid, context.knownFolders);
    const notes = await readMarkerRepairNotes(this.app, current.templatePatterns, signal);
    const { inspection, knownMatches } = await inspectMarkerRepair(current, signal);
    signal?.throwIfAborted();
    if (mutationSequence !== this.host.sequence()) {
      throw new Error('Bindings changed during inspection. Preview again.');
    }
    return buildMarkerRepairPlan({ context: current, inspection, knownMatches, mutationSequence, notes });
  }

  public dispose(): void {
    this.disposed = true;
    for (const dialog of this.dialogs) {
      dialog.close();
    }
    this.dialogs.clear();
  }

  public async execute(plan: MarkerRepairPlan, journalPath?: string, signal?: AbortSignal): Promise<void> {
    await this.host.mutate(async () => {
      if (plan.mutationSequence !== this.host.sequence()) {
        throw new Error('Repair preview is stale. Preview again.');
      }
      await this.host.assertNoPending(plan.targetPath, journalPath);
      await this.revalidate(plan, signal);
      const operations = this.operations(plan, signal);
      if (journalPath) {
        await updateMarkerRepairJournal(journalPath, plan);
      }
      const result = journalPath
        ? await resumeSetupJournal({ journalPath, operations })
        : await executeSetupPlan({ journalRootPath: this.host.journalRoot(), operations, plan });
      this.host.changed(plan.targetPath, result.succeeded ? plan.notePath : null);
      if (!result.succeeded) {
        throw new Error(`Marker repair stopped: ${result.journal.message ?? ''}\nJournal: ${result.journalPath}`);
      }
    });
  }

  public async pending(): Promise<({ journalPath: string } & SetupJournal)[]> {
    return (await listIncompleteSetupJournals(this.host.journalRoot())).filter((journal) => journal.action === 'create-missing-marker');
  }

  public async preview(notePath: string, targetPath: string, knownFolders: string[] = [], journalPath?: string): Promise<void> {
    const modal = new Modal(this.app);
    const abort = new AbortController();
    this.dialogs.add(modal);
    modal.titleEl.setText('Create missing marker');
    modal.onClose = (): void => {
      abort.abort();
      this.dialogs.delete(modal);
    };
    modal.open();
    const status = modal.contentEl.createEl('p', { text: 'Checking note ownership and the folder…' });
    const cancel = modal.contentEl.createEl('button', { text: 'Cancel' });
    cancel.onclick = (): void => {
      modal.close();
    };
    try {
      await this.host.assertNoPending(targetPath, journalPath);
      const saved = journalPath ? await readSetupJournal(journalPath) : undefined;
      const note = await readMarkerRepairNote(this.app, notePath);
      if (note.identity.kind !== 'valid') {
        throw new Error('The selected note must still have a valid external folder identifier.');
      }
      if (saved && (saved.notePath !== notePath || saved.targetPath !== targetPath || saved.uuid !== note.identity.uuid)) {
        throw new Error('The journaled note identity changed.');
      }
      const context = await this.context(notePath, targetPath, note.identity.uuid, [...knownFolders, ...(saved?.repairContext?.knownFolders ?? [])]);
      const plan = await this.check(context, abort.signal);
      if (this.disposed || abort.signal.aborted) {
        return;
      }
      status.setText(plan.errors.length ? plan.errors.join('\n') : 'Only the marker will be created. The note, UUID, and folder contents remain unchanged.');
      modal.contentEl.createEl('p', {
        text: `Note: ${plan.notePath}\nUUID: ${plan.uuid}\nFolder: ${plan.targetPath}\nMarker: ${plan.targetPath}/${buildExnfMarkerFileName(plan.uuid)}`
      });
      modal.contentEl.createEl('p', {
        text: 'Checks cover this note’s ownership, the target, ancestors, and included descendants. Other locations may contain undiscovered markers.'
      });
      if (plan.omissions.length) {
        const details = modal.contentEl.createEl('details');
        details.createEl('summary', { text: `Intentional exclusions (${String(plan.omissions.length)})` });
        for (const omission of plan.omissions) {
          details.createEl('p', { text: `${omission.location}\n${omission.reason}` });
        }
      }
      for (const folder of plan.knownMatches) {
        const inspect = modal.contentEl.createEl('button', { text: 'Inspect existing binding' });
        inspect.onclick = (): void => {
          this.host.openFolder(folder).catch((error: unknown) => {
            status.setText(String(error));
          });
        };
      }
      const confirm = modal.contentEl.createEl('button', { text: 'Create marker' });
      confirm.disabled = plan.errors.length > 0;
      confirm.onclick = (): void => {
        confirm.disabled = true;
        this.execute(plan, journalPath, abort.signal).then(async () => {
          modal.close();
          await this.host.refresh();
        }).catch((error: unknown) => {
          status.setText(String(error));
          const retry = modal.contentEl.createEl('button', { text: 'Review pending operation / preview again' });
          retry.onclick = (): void => {
            this.pending().then(async (pending) => {
              const journal = pending.find((item) => item.notePath === notePath);
              modal.close();
              await this.preview(notePath, targetPath, knownFolders, journal?.journalPath);
            }).catch((failure: unknown) => {
              status.setText(String(failure));
            });
          };
        });
      };
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        status.setText(`Marker creation could not be checked: ${String(error)}`);
      }
    }
  }

  private assertJournal(plan: MarkerRepairPlan, journal: SetupJournal): void {
    if (
      journal.action !== 'create-missing-marker' || journal.notePath !== plan.notePath || journal.uuid !== plan.uuid || journal.targetPath !== plan.targetPath
      || journal.externalRootPath !== plan.externalRootPath
    ) {
      throw new Error('Repair journal identity changed.');
    }
  }

  private async context(notePath: string, targetPath: string, uuid: string, knownFolders: string[]): Promise<MarkerRepairContext> {
    const settings = this.host.settings();
    const externalRootPath = await resolveExternalRootPath(settings.externalRootPath);
    if (identity(deriveExternalFolderPath(notePath, externalRootPath)) !== identity(targetPath)) {
      throw new Error('The selected note does not map to this folder.');
    }
    return {
      externalRootPath,
      ignorePatterns: [...settings.externalRootIgnorePatterns],
      knownFolders: [...new Set([...knownFolders, ...this.host.knownFolders(uuid)])].sort(),
      notePath,
      targetPath,
      templatePatterns: [...(settings.templateExcludePatterns ?? [])],
      uuid
    };
  }

  private operations(plan: MarkerRepairPlan, signal?: AbortSignal): SetupExecutionOperations {
    async function forbidden(): Promise<void> {
      throw new Error('Marker repair cannot create folders or write notes.');
    }
    return {
      assertComplete: async (journal): Promise<void> => {
        this.assertJournal(plan, journal);
        if (!(await this.revalidate(plan, signal)).markerPresent) {
          throw new Error('Marker is still missing. Review pending repair.');
        }
      },
      createFolder: forbidden,
      writeMarker: async (journal): Promise<void> => {
        this.assertJournal(plan, journal);
        const fresh = await this.revalidate(plan, signal);
        const selected = await readMarkerRepairNote(this.app, plan.notePath);
        if (selected.identity.kind !== 'valid' || selected.identity.uuid !== plan.uuid) {
          throw new Error('Note identity changed before marker creation.');
        }
        signal?.throwIfAborted();
        if (!fresh.markerPresent) {
          try {
            await writeExpectedMarkerIfMissingOrMatching({ externalRootPath: plan.externalRootPath, notePath: plan.notePath, uuid: plan.uuid });
          } catch (error: unknown) {
            if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
              throw error;
            }
            if (!(await this.revalidate(plan, signal)).markerPresent) {
              throw error;
            }
          }
        }
      },
      writeNoteUuid: forbidden
    };
  }

  private async revalidate(plan: MarkerRepairPlan, signal?: AbortSignal): Promise<MarkerRepairPlan> {
    const fresh = await this.check(plan.repairContext, signal);
    if (fresh.errors.length) {
      throw new Error(fresh.errors.join('\n'));
    }
    if (!sameMarkerRepairScope(plan, fresh)) {
      throw new Error('Repair settings or exclusions changed. Preview again.');
    }
    return fresh;
  }
}
