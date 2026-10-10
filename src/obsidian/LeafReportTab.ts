import type { WorkspaceLeaf } from 'obsidian';

import {
  ItemView,
  TFile
} from 'obsidian';

import type { LeafRow } from '../core/leafQuery.ts';
import type { VerifiedBindingChange } from '../core/verifiedBindingChange.ts';
import type { AuditMutationState } from '../ui/auditSession.ts';
import type { LeafReportView } from '../ui/leafReportView.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import { buildAuditExportSummary } from '../core/auditExportSummary.ts';
import { buildAuditTableSteps } from '../core/auditReport.ts';
import { folderStatusTable } from '../core/folderStatusCsv.ts';
import { buildLeafReportSteps } from '../core/leafReport.ts';
import { deriveExternalFolderPath } from '../core/pathPolicy.ts';
import { inspectAdoption } from '../storage/adoptionInspection.ts';
import {
  assertAuditRoots,
  openExistingAuditFolder
} from '../storage/auditPaths.ts';
import { scanAdoptionAudit } from '../storage/auditScan.ts';
import { writeAuditReports } from '../storage/auditWriter.ts';
import { AuditSession } from '../ui/auditSession.ts';
import {
  AUDIT_CSV_NAMES,
  mountLeafReport
} from '../ui/leafReportView.ts';
import { AuditExportModal } from './AuditExportModal.ts';

export const LEAF_REPORT_VIEW_TYPE = 'external-note-folders-leaf-report';
export interface LeafReportTabOptions {
  adopt?: (folder: string, knownMarkerPaths: string[]) => void;
  createMissingMarker?: (notePath: string, folderPath: string, knownFolders: string[]) => Promise<void>;
  externalRoot: () => string;
  mutationState: () => AuditMutationState;
  openTemplateSettings?: () => void;
  pending?: () => Promise<number>;
  pendingRepairs?: () => Promise<{ targetPath: string }[]>;
  repair?: (folder: string, direction: 'external' | 'note') => Promise<void>;
  resume?: () => Promise<void>;
  scanPatterns?: () => string[];
  templatePatterns?: () => string[];
}

export class LeafReportTab extends ItemView {
  private destination = '';
  private report: LeafReportView | undefined;
  private retryButton: HTMLButtonElement | undefined;
  private retryChange: undefined | VerifiedBindingChange;

  private session: AuditSession | undefined;

  public constructor(leaf: WorkspaceLeaf, private readonly options: LeafReportTabOptions) {
    super(leaf);
  }

  public async applyVerified(change: VerifiedBindingChange): Promise<void> {
    try {
      await this.session?.applyVerified(change);
    } catch (error: unknown) {
      this.showReportStatus(`Adoption completed; status update needs verification. ${String(error)}`);
      this.retryChange = change;
      this.retryButton?.remove();
      const button = this.contentEl.createEl('button', { text: 'Retry status verification' });
      this.retryButton = button;
      button.onclick = (): void => {
        button.disabled = true;
        this.retryVerification().catch((failure: unknown) => {
          this.showReportStatus(`Adoption completed; status update needs verification. ${String(failure)}`);
        }).finally(() => {
          button.disabled = false;
        });
      };
    }
  }

  public override getDisplayText(): string {
    return 'External folder status';
  }

  public override getIcon(): string {
    return 'folder-search';
  }

  public override getViewType(): string {
    return LEAF_REPORT_VIEW_TYPE;
  }

  public knownMarkerFolders(uuid: string): string[] {
    return (this.session?.workingSnapshot?.markers ?? []).filter((marker) => marker.uuid === uuid).map((marker) => marker.folderPath);
  }

  public knownMarkerPaths(): string[] {
    const snapshot = this.session?.workingSnapshot;
    return [
      ...new Set([
        ...(snapshot?.markers.map((marker) => marker.markerPath) ?? []),
        ...(snapshot?.issues.filter((issue) => issue.scope === 'external' && (issue.kind === 'marker' || issue.location.toLowerCase().endsWith('.exnf'))).map((
          issue
        ) => issue.location) ?? [])
      ])
    ];
  }

  public markAdopted(folder: string, note: null | string): void {
    if (this.session?.model && note !== null) {
      this.session.model = { ...this.session.model, stale: true };
    }
    this.report?.adopted(folder, note);
  }

  public override onClose(): Promise<void> {
    this.shutdown();
    return Promise.resolve();
  }

  public override async onOpen(): Promise<void> {
    this.contentEl.replaceChildren();
    this.report = mountLeafReport(this.contentEl, {
      ...(this.options.createMissingMarker
        ? {
          createMissingMarker: async (notePath: string, folderPath: string): Promise<void> => {
            const note = this.session?.workingSnapshot?.notes.find((item) => item.relativePath === notePath);
            await this.options.createMissingMarker?.(notePath, folderPath, note ? this.knownMarkerFolders(note.uuid) : []);
          }
        }
        : {}),
      ...(this.options.adopt ? { adopt: this.options.adopt } : {}),
      ...(this.options.resume ? { resume: this.options.resume } : {}),
      ...(this.options.repair ? { repair: this.options.repair } : {}),
      ...(this.options.openTemplateSettings ? { openTemplateSettings: this.options.openTemplateSettings } : {}),
      cancel: () => this.session?.cancel(),
      copy: async (text) => navigator.clipboard.writeText(text),
      exportLeaves: async (rows, filtered) => this.exportRows(rows, filtered),
      exportReport: async (name) => this.exportReport(name),
      exportStatus: async (nodes, filtered): Promise<void> => {
        await this.session?.runExport(async (_snapshot, model, signal) => {
          const destination = await this.chooseDestination(signal);
          if (!destination) {
            return null;
          }
          const name = filtered ? 'filtered-folder-status.csv' : 'folder-status.csv';
          const table = folderStatusTable(nodes);
          return writeAuditReports(
            { complete: model.uncheckedCount === 0, summary: buildAuditExportSummary(model, name, table.rows.length), tables: { [name]: table } },
            destination,
            signal
          );
        });
      },
      initialContext: {
        externalRoot: this.options.externalRoot(),
        vaultRoot: (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ''
      },
      openFolder: async (folderPath) => {
        await openExistingAuditFolder(folderPath);
      },
      openNote: async (notePath) => {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (!(file instanceof TFile)) {
          throw new Error('This note is not available through Obsidian. Copy its path from the report.');
        }
        await this.app.workspace.getLeaf('tab').openFile(file);
      },
      refresh: async () => this.session?.refresh(),
      rescanUnfiltered: async () => this.session?.refresh('unfiltered')
    });
    this.session = new AuditSession({
      actionStatus: (message, busy): void => this.report?.status(message, busy, 'action'),
      analyze: async (snapshot, signal): Promise<import('../core/leafQuery.ts').LeafReportModel> => runAuditSteps(buildLeafReportSteps(snapshot), { signal }),
      configuration: (): { ignorePatterns: string[]; templatePatterns: string[] } => ({
        ignorePatterns: [...(this.options.scanPatterns?.() ?? [])],
        templatePatterns: [...(this.options.templatePatterns?.() ?? [])]
      }),
      mutationState: this.options.mutationState,
      scan: async (control): Promise<import('../core/auditTypes.ts').AuditSnapshot> => {
        const adapter = this.app.vault.adapter as { getBasePath?: () => string };
        const vaultRoot = adapter.getBasePath?.();
        const externalRoot = this.options.externalRoot();
        assertAuditRoots(vaultRoot, externalRoot);
        return scanAdoptionAudit(vaultRoot, externalRoot, {
          ...control,
          ignorePatterns: [...(this.options.scanPatterns?.() ?? [])],
          templateExcludePatterns: [...(this.options.templatePatterns?.() ?? [])]
        });
      },
      scanContext: (): import('../ui/scanFailure.ts').ScanContext => ({
        externalRoot: this.options.externalRoot(),
        vaultRoot: (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ''
      }),
      scanFailure: (failure): void => this.report?.scanFailure(failure),
      status: (message, busy): void => this.report?.status(message, busy, 'scan'),
      update: async (model, signal): Promise<void> => this.report?.update(model, signal)
    });
    await this.session.refresh();
    try {
      for (const repair of await this.options.pendingRepairs?.() ?? []) {
        this.markAdopted(repair.targetPath, null);
      }
      const pending = await this.options.pending?.();
      if (pending) {
        this.showReportStatus(`${String(pending)} pending folder operation(s). Use Review pending operation or Resume folder adoption.`);
      }
    } catch (error: unknown) {
      this.showReportStatus(`Cannot inspect pending adoptions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async refreshAfterRepair(): Promise<void> {
    await this.session?.refreshAfterMutation(this.session.model?.statusScanMode ?? 'filtered');
  }

  public shutdown(): void {
    this.session?.dispose();
    this.report?.dispose();
    this.session = undefined;
    this.report = undefined;
  }

  private async chooseDestination(signal: AbortSignal): Promise<null | string> {
    const destination = await new Promise<null | string>((resolve) => {
      new AuditExportModal(this.app, this.destination, signal, resolve).open();
    });
    if (destination) {
      this.destination = destination;
    }
    return destination;
  }

  private async exportReport(name: string): Promise<void> {
    if (!AUDIT_CSV_NAMES.includes(name)) {
      return;
    }
    await this.session?.runExport(async (snapshot, model, signal) => {
      const destination = await this.chooseDestination(signal);
      if (!destination) {
        return null;
      }
      const table = await runAuditSteps(buildAuditTableSteps(snapshot, name), { signal });
      return writeAuditReports(
        {
          complete: model.uncheckedCount === 0,
          summary: buildAuditExportSummary(model, name, table.rows.length),
          tables: { [name]: table }
        },
        destination,
        signal
      );
    }, true);
  }

  private async exportRows(rows: readonly LeafRow[], filtered: boolean): Promise<void> {
    await this.session?.runExport(async (_snapshot, model, signal) => {
      const destination = await this.chooseDestination(signal);
      if (!destination) {
        return null;
      }
      const name = filtered ? 'filtered-unmarked-leaf-folders.csv' : 'unmarked-leaf-folders.csv';
      return writeAuditReports(
        {
          complete: model.uncheckedCount === 0,
          summary: buildAuditExportSummary(model, name, rows.length),
          tables: {
            [name]: { columns: ['folderPath', 'relativePath'], rows: rows.map(({ folderPath, relativePath }) => ({ folderPath, relativePath })) }
          }
        },
        destination,
        signal
      );
    });
  }

  private async retryVerification(): Promise<void> {
    const previous = this.retryChange;
    if (!previous) {
      return;
    }
    const { snapshot: evidence } = await inspectAdoption({
      externalRoot: previous.externalRoot,
      ignorePatterns: this.options.scanPatterns?.() ?? [],
      knownMarkerPaths: this.knownMarkerPaths(),
      targets: [...previous.affectedFolders, deriveExternalFolderPath(previous.newNotePath, previous.externalRoot)],
      templatePatterns: this.options.templatePatterns?.() ?? [],
      vaultRoot: previous.vaultRoot
    });
    await this.session?.applyVerified({ ...previous, evidence, verifiedAt: evidence.finishedAt });
    this.retryChange = undefined;
    this.retryButton?.remove();
  }

  private showReportStatus(message: string): void {
    this.report?.status(message, false);
  }
}
