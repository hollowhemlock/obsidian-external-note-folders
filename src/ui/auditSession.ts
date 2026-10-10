import type { AuditSnapshot } from '../core/auditTypes.ts';
import type { LeafReportModel } from '../core/leafQuery.ts';
import type { VerifiedBindingChange } from '../core/verifiedBindingChange.ts';
import type { AuditScanOptions } from '../storage/auditScan.ts';
import type {
  ScanContext,
  ScanFailure
} from './scanFailure.ts';

import { normalizeExternalRootIgnorePatterns } from '../core/externalRootIgnore.ts';
import { scanProblemSummary } from '../core/scanCoveragePresentation.ts';
import { mergeVerifiedEvidence } from '../core/verifiedBindingChange.ts';
import { createScanFailure } from './scanFailure.ts';

const PROGRESS_INTERVAL_MS = 100;

export interface AuditMutationState {
  active: boolean;
  activity: number;
  sequence: number;
}
export interface AuditSessionHost {
  actionStatus?: (message: string, busy: boolean) => void;
  analyze: (snapshot: AuditSnapshot, signal: AbortSignal) => Promise<LeafReportModel>;
  configuration?: () => { ignorePatterns: string[]; templatePatterns: string[] };
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
  public originalModel: LeafReportModel | undefined;
  /** Original completed scan, reserved for forensic exports. */
  public snapshot: AuditSnapshot | undefined;
  public workingSnapshot: AuditSnapshot | undefined;
  private applying = false;
  private readonly completed = new Set<string>();
  private configuration: string | undefined;
  private controller: AbortController | undefined;
  private disposed = false;
  private mutationRevision = -1;
  private pendingRefresh: import('../core/auditTypes.ts').StatusScanMode | undefined;
  private revision = 0;
  private scanning = false;
  private updates: Promise<void> = Promise.resolve();

  public constructor(private readonly host: AuditSessionHost) {
  }

  public applyVerified(change: VerifiedBindingChange): Promise<void> {
    const apply = async (): Promise<void> => {
      if (this.disposed || this.completed.has(change.operationId) || change.mutationRevision < this.mutationRevision) {
        return;
      }
      const baseline = this.workingSnapshot;
      const previous = this.model;
      if (!baseline || !previous) {
        throw new Error('No usable report baseline; refresh the report.');
      }
      this.assertCompatible(change, baseline);
      if (this.scanning) {
        this.controller?.abort();
      }
      const evidence = mergeVerifiedEvidence(baseline, change);
      const control = new AbortController();
      const analyzed = await this.host.analyze(evidence, control.signal);
      if (this.isDisposed()) {
        return;
      }
      const model = {
        ...analyzed,
        mutationWarning: previous.mutationWarning,
        revision: this.revision + 1,
        stale: previous.stale ?? false,
        verifiedChanges: [...(previous.verifiedChanges ?? []), {
          folders: change.affectedFolders,
          operationId: change.operationId,
          verifiedAt: change.verifiedAt
        }]
      };
      await this.host.update(model, control.signal);
      if (this.isDisposed()) {
        return;
      }
      this.workingSnapshot = evidence;
      this.model = model;
      this.revision++;
      this.mutationRevision = change.mutationRevision;
      this.completed.add(change.operationId);
      this.host.status('Adoption verified. Current binding evidence updated; original scan scope retained.', false);
    };
    const next = this.updates.then(async () => {
      this.applying = true;
      try {
        await apply();
      } finally {
        this.applying = false;
      }
    });
    this.updates = next.catch(() => undefined);
    return next;
  }

  public cancel(): void {
    this.controller?.abort();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  public async refresh(statusScanMode: import('../core/auditTypes.ts').StatusScanMode = 'filtered'): Promise<void> {
    if (this.controller || this.applying || this.isDisposed()) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const before = this.host.mutationState();
    const configuration = configurationKey(this.host.configuration?.());
    const startedRevision = this.revision;
    this.scanning = true;
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
      assertReadableRoots(snapshot);
      this.host.status('Analyzing leaf folders…', true);
      const model = await this.host.analyze(snapshot, controller.signal);
      controller.signal.throwIfAborted();
      const after = this.host.mutationState();
      model.mutationWarning = mutationOverlaps(before, after);
      if (this.scanSuperseded(startedRevision, model)) {
        this.host.status('Scan superseded by a mutation. Verified working results retained.', false);
        return;
      }
      if (this.disposed || this.pendingRefresh) {
        return;
      }
      await this.host.update(model, controller.signal);
      controller.signal.throwIfAborted();
      if (startedRevision !== this.revision) {
        return;
      }
      this.configuration = configuration;
      this.snapshot = snapshot;
      this.workingSnapshot = snapshot;
      this.originalModel = model;
      this.model = model;
      this.revision++;
      this.mutationRevision = after.sequence;
      this.completed.clear();
      this.setFailure(null);
      this.host.status(
        scanProblemSummary(snapshot.issues)
          ? 'Scan complete with warnings. See Scan details for scan problems.'
          : 'Scan complete. Results describe the recorded scan time.',
        false
      );
    } catch (error: unknown) {
      if (!this.isDisposed()) {
        this.setFailure(controller.signal.aborted ? null : createScanFailure(error, context, statusScanMode, !!this.snapshot));
        this.host.status(scanAttemptStatus(controller.signal.aborted, !!this.snapshot, startedRevision !== this.revision), false);
      }
    } finally {
      this.scanning = false;
      if (this.controller === controller) {
        this.controller = undefined;
      }
      await this.flushPendingRefresh();
    }
  }

  /** Coalesce a required refresh after active scans or exports finish. */
  public async refreshAfterMutation(statusScanMode: import('../core/auditTypes.ts').StatusScanMode): Promise<void> {
    if (this.model) {
      this.model = { ...this.model, stale: true };
    }
    this.pendingRefresh = statusScanMode;
    await this.flushPendingRefresh();
  }

  public async runExport(
    operation: (snapshot: AuditSnapshot, model: LeafReportModel, signal: AbortSignal) => Promise<null | string>,
    original = false
  ): Promise<void> {
    if (!this.snapshot || !this.model || this.controller || this.disposed) {
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.exportStatus('Preparing export…', true);
    try {
      const directory = await operation(
        original ? this.snapshot : this.workingSnapshot ?? this.snapshot,
        original ? this.originalModel ?? this.model : this.model,
        controller.signal
      );
      controller.signal.throwIfAborted();
      if (!this.isDisposed()) {
        this.exportStatus(directory ? `Exported to ${directory}` : 'Export cancelled.', false);
      }
    } catch (error: unknown) {
      if (!this.isDisposed()) {
        this.exportStatus(
          controller.signal.aborted ? 'Export cancelled.' : `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          false
        );
      }
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
      await this.flushPendingRefresh();
    }
  }

  private assertCompatible(change: VerifiedBindingChange, baseline: AuditSnapshot): void {
    const currentConfiguration = this.host.configuration?.();
    if (
      currentConfiguration && (configurationKey(currentConfiguration) !== this.configuration
        || configurationKey(currentConfiguration) !== configurationKey({ ignorePatterns: change.ignorePatterns, templatePatterns: change.templatePatterns }))
    ) {
      throw new Error('Report configuration changed; refresh the report.');
    }
    const context = this.host.scanContext?.();
    if (
      (context?.externalRoot && context.externalRoot !== change.externalRoot)
      || (context?.vaultRoot && context.vaultRoot !== change.vaultRoot)
    ) {
      throw new Error('Report roots changed; refresh the report.');
    }
    if (
      JSON.stringify(baseline.templateExclusions?.patterns ?? []) !== JSON.stringify(normalizeExternalRootIgnorePatterns(change.templatePatterns).patterns)
      || (baseline.statusScanMode !== 'unfiltered'
        && JSON.stringify(baseline.external.ignorePatterns) !== JSON.stringify(normalizeExternalRootIgnorePatterns(change.ignorePatterns).patterns))
    ) {
      throw new Error('Report configuration changed; refresh the report.');
    }
  }

  private exportStatus(message: string, busy: boolean): void {
    (this.host.actionStatus ?? this.host.status)(message, busy);
  }

  private async flushPendingRefresh(): Promise<void> {
    if (this.controller || this.disposed || !this.pendingRefresh) {
      return;
    }
    const mode = this.pendingRefresh;
    this.pendingRefresh = undefined;
    await this.refresh(mode);
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private scanSuperseded(startedRevision: number, model: LeafReportModel): boolean {
    return !!this.model && (startedRevision !== this.revision || model.mutationWarning);
  }

  private setFailure(failure: null | ScanFailure): void {
    this.failure = failure;
    this.host.scanFailure?.(failure);
  }
}

function assertReadableRoots(snapshot: AuditSnapshot): void {
  const rootIssue = snapshot.issues.find((issue) => issue.unchecked && (issue.location === snapshot.vaultRoot || issue.location === snapshot.externalRoot));
  if (rootIssue) {
    throw Object.assign(new Error(`A source root could not be inspected. ${rootIssue.reason}`), { path: rootIssue.location });
  }
}

function configurationKey(configuration: { ignorePatterns: string[]; templatePatterns: string[] } | undefined): string | undefined {
  return configuration
    ? JSON.stringify({
      ignorePatterns: normalizeExternalRootIgnorePatterns(configuration.ignorePatterns),
      templatePatterns: normalizeExternalRootIgnorePatterns(configuration.templatePatterns)
    })
    : undefined;
}

function mutationOverlaps(before: AuditMutationState, after: AuditMutationState): boolean {
  return before.active || after.active || before.sequence !== after.sequence || before.activity !== after.activity;
}

function scanAttemptStatus(aborted: boolean, previous: boolean, superseded: boolean): string {
  if (aborted && superseded) {
    return 'Scan superseded by verified binding updates. Working results retained.';
  }
  const retained = previous ? 'Previous results retained.' : 'No completed scan.';
  return aborted ? `Scan cancelled. ${retained}` : `Scan failed. ${retained} See Scan details.`;
}
