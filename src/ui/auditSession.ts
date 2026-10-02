import type { AuditSnapshot } from '../core/auditTypes.ts';
import type { LeafReportModel } from '../core/leafQuery.ts';
import type { AuditScanOptions } from '../storage/auditScan.ts';
import type {
  ScanContext,
  ScanFailure
} from './scanFailure.ts';

import { createScanFailure } from './scanFailure.ts';

const PROGRESS_INTERVAL_MS = 100;

export interface AuditMutationState {
  active: boolean;
  activity: number;
  sequence: number;
}
export interface AuditSessionHost {
  analyze: (snapshot: AuditSnapshot, signal: AbortSignal) => Promise<LeafReportModel>;
  mutationState: () => AuditMutationState;
  scan: (options: AuditScanOptions) => Promise<AuditSnapshot>;
  scanContext?: () => ScanContext;
  scanFailure?: (failure: null | ScanFailure) => void;
  status: (message: string, busy: boolean) => void;
  update: (model: LeafReportModel, signal: AbortSignal) => Promise<void>;
}

export class AuditSession {
  public failure: null | ScanFailure = null;
  public model: LeafReportModel | undefined;
  public snapshot: AuditSnapshot | undefined;
  private controller: AbortController | undefined;
  private disposed = false;

  public constructor(private readonly host: AuditSessionHost) {
  }

  public cancel(): void {
    this.controller?.abort();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  public async refresh(statusScanMode: import('../core/auditTypes.ts').StatusScanMode = 'filtered'): Promise<void> {
    if (this.controller || this.isDisposed()) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const before = this.host.mutationState();
    let lastProgress = 0;
    let context: ScanContext = {};
    this.host.status('Scanning physical roots…', true);
    try {
      context = this.host.scanContext?.() ?? {};
      const snapshot = await this.host.scan({
        onProgress: (counts) => {
          if (this.disposed || performance.now() - lastProgress < PROGRESS_INTERVAL_MS) {
            return;
          }
          lastProgress = performance.now();
          this.host.status(
            `Scanning: ${counts.directories.toLocaleString()} folders · ${counts.notes.toLocaleString()} notes · ${counts.markers.toLocaleString()} markers`,
            true
          );
        },
        signal: controller.signal,
        statusScanMode
      });
      controller.signal.throwIfAborted();
      const rootIssue = snapshot.issues.find((issue) => issue.unchecked && (issue.location === snapshot.vaultRoot || issue.location === snapshot.externalRoot));
      if (rootIssue) {
        throw Object.assign(new Error(`A source root could not be inspected. ${rootIssue.reason}`), { path: rootIssue.location });
      }
      this.host.status('Analyzing leaf folders…', true);
      const model = await this.host.analyze(snapshot, controller.signal);
      controller.signal.throwIfAborted();
      const after = this.host.mutationState();
      model.mutationWarning = before.active || after.active || before.sequence !== after.sequence || before.activity !== after.activity;
      if (this.disposed) {
        return;
      }
      await this.host.update(model, controller.signal);
      this.snapshot = snapshot;
      this.model = model;
      this.setFailure(null);
      this.host.status(
        snapshot.issues.some((issue) => issue.code === 'git-repository-unavailable')
          ? 'Scan complete with warnings. See Scan details for skipped repositories.'
          : 'Scan complete. Results describe the recorded scan time.',
        false
      );
    } catch (error: unknown) {
      if (!this.isDisposed()) {
        this.setFailure(controller.signal.aborted ? null : createScanFailure(error, context, statusScanMode, !!this.snapshot));
        this.host.status(
          controller.signal.aborted
            ? `Scan cancelled. ${this.snapshot ? 'Previous results retained.' : 'No completed scan.'}`
            : `Scan failed. ${this.snapshot ? 'Previous results retained.' : 'No completed scan.'} See Scan details.`,
          false
        );
      }
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  public async runExport(operation: (snapshot: AuditSnapshot, model: LeafReportModel, signal: AbortSignal) => Promise<null | string>): Promise<void> {
    if (!this.snapshot || !this.model || this.controller || this.disposed) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.host.status('Preparing export…', true);
    try {
      const directory = await operation(this.snapshot, this.model, controller.signal);
      controller.signal.throwIfAborted();
      if (!this.isDisposed()) {
        this.host.status(directory ? `Exported to ${directory}` : 'Export cancelled.', false);
      }
    } catch (error: unknown) {
      if (!this.isDisposed()) {
        this.host.status(controller.signal.aborted ? 'Export cancelled.' : `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, false);
      }
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private setFailure(failure: null | ScanFailure): void {
    this.failure = failure;
    this.host.scanFailure?.(failure);
  }
}
