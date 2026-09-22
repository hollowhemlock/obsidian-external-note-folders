import type { AuditSnapshot } from '../core/auditTypes.ts';
import type { LeafReportModel } from '../core/leafQuery.ts';
import type { AuditScanOptions } from '../storage/auditScan.ts';

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
  status: (message: string, busy: boolean) => void;
  update: (model: LeafReportModel, signal: AbortSignal) => Promise<void>;
}

export class AuditSession {
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

  public async refresh(): Promise<void> {
    if (this.controller || this.isDisposed()) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const before = this.host.mutationState();
    let lastProgress = 0;
    this.host.status('Scanning physical roots…', true);
    try {
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
        signal: controller.signal
      });
      controller.signal.throwIfAborted();
      if (snapshot.issues.some((issue) => issue.unchecked && (issue.location === snapshot.vaultRoot || issue.location === snapshot.externalRoot))) {
        throw new Error('A source root could not be inspected.');
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
      this.host.status('Scan complete. Results describe the recorded scan time.', false);
    } catch (error: unknown) {
      if (!this.isDisposed()) {
        this.host.status(
          controller.signal.aborted
            ? 'Scan cancelled. Previous results retained.'
            : `Scan failed. Previous results retained. ${error instanceof Error ? error.message : ''}`,
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
}
