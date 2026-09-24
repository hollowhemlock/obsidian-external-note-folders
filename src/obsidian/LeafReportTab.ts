import type { WorkspaceLeaf } from 'obsidian';

import {
  ItemView,
  TFile
} from 'obsidian';

import type { LeafRow } from '../core/leafQuery.ts';
import type { AuditMutationState } from '../ui/auditSession.ts';
import type { LeafReportView } from '../ui/leafReportView.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import { buildAuditExportSummary } from '../core/auditExportSummary.ts';
import { buildAuditTableSteps } from '../core/auditReport.ts';
import { folderStatusTable } from '../core/folderStatusCsv.ts';
import { buildLeafReportSteps } from '../core/leafReport.ts';
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
  adopt?: (folder: string) => void;
  externalRoot: () => string;
  mutationState: () => AuditMutationState;
  openTemplateSettings?: () => void;
  pending?: () => Promise<number>;
  repair?: (folder: string, direction: 'external' | 'note') => Promise<void>;
  resume?: () => Promise<void>;
  scanPatterns?: () => string[];
  templatePatterns?: () => string[];
}

export class LeafReportTab extends ItemView {
  private destination = '';
  private report: LeafReportView | undefined;
  private session: AuditSession | undefined;
  public constructor(leaf: WorkspaceLeaf, private readonly options: LeafReportTabOptions) {
    super(leaf);
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

  public markAdopted(folder: string, note: null | string): void {
    if (this.session?.model) {
      this.session.model.stale = true;
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
      refresh: async () => this.session?.refresh()
    });
    this.session = new AuditSession({
      analyze: async (snapshot, signal): Promise<import('../core/leafQuery.ts').LeafReportModel> => runAuditSteps(buildLeafReportSteps(snapshot), { signal }),
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
      status: (message, busy): void => this.report?.status(message, busy),
      update: async (model, signal): Promise<void> => this.report?.update(model, signal)
    });
    await this.session.refresh();
    try {
      const pending = await this.options.pending?.();
      if (pending) {
        this.showReportStatus(`${String(pending)} pending folder adoption(s). Use Resume folder adoption.`);
      }
    } catch (error: unknown) {
      this.showReportStatus(`Cannot inspect pending adoptions: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    });
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

  private showReportStatus(message: string): void {
    this.report?.status(message, false);
  }
}
