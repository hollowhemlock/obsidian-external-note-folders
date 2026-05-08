import type { TFile } from 'obsidian';

import {
  Notice,
  Plugin as ObsidianPlugin
} from 'obsidian';

import type { ExnfFrontmatterValue } from './core/frontmatter.ts';
import type { PluginSettings } from './PluginSettings.ts';
import type { ExpectedExternalFolderInspection } from './storage/boundExternalFolder.ts';

import { AdoptExpectedFolderModal } from './AdoptExpectedFolderModal.ts';
import { getActiveFolderDrift } from './core/activeFolderDrift.ts';
import { toExternalRelativeDisplayPath } from './core/displayPath.ts';
import { buildDriftReport } from './core/driftReport.ts';
import { getExnfFrontmatterValue } from './core/frontmatter.ts';
import {
  chooseInitialOpenExternalFolderAction,
  chooseOpenExternalFolderFallbackAction
} from './core/openExternalFolderFlow.ts';
import { buildReconcilePlan } from './core/reconcilePlan.ts';
import { buildVerifyReport } from './core/verify.ts';
import { DriftReportModal } from './DriftReportModal.ts';
import { assignUuidToNote } from './obsidian/assignUuidToNote.ts';
import { scanVault } from './obsidian/scanVault.ts';
import { DEFAULT_SETTINGS } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { ReconcilePlanModal } from './ReconcilePlanModal.ts';
import {
  ensureExpectedBoundExternalFolder,
  inspectExpectedExternalFolder,
  openExternalFolderInFileManager,
  resolveExternalRootPath,
  writeExpectedMarkerIfUnmarked
} from './storage/boundExternalFolder.ts';
import { buildJournalRootPath } from './storage/journalPath.ts';
import { executeReconcilePlan } from './storage/reconcileExecutor.ts';
import { scanExternalRoot } from './storage/scanExternalRoot.ts';
import { VerifyReportModal } from './VerifyReportModal.ts';

interface ScanContext {
  externalScan: Awaited<ReturnType<typeof scanExternalRoot>>;
  vaultScan: ReturnType<typeof scanVault>;
  verifyReport: ReturnType<typeof buildVerifyReport>;
}

interface VaultAdapterWithBasePath {
  getBasePath: () => string;
}

const LOG_PREFIX = '[external-note-folders]';

export class Plugin extends ObsidianPlugin {
  public settings: PluginSettings = DEFAULT_SETTINGS;

  private isMutationInProgress = false;
  private mutationSequence = 0;

  public override async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new PluginSettingsTab(this.app, this));

    this.addCommand({
      callback: () => {
        this.runAssignUuidCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'assign-external-folder-uuid',
      name: 'Assign external folder identifier'
    });

    this.addCommand({
      callback: () => {
        this.runReportExternalFolderDriftCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'report-external-folder-drift',
      name: 'Report external folder drift'
    });

    this.addCommand({
      callback: () => {
        this.runOpenExternalFolderCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'open-external-folder',
      name: 'Open external folder'
    });

    this.addCommand({
      callback: () => {
        this.runReconcileCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'reconcile-external-folders',
      name: 'Reconcile external folders'
    });
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async collectScanContext(): Promise<ScanContext> {
    const vaultScan = scanVault(this.app);
    const externalScan = await scanExternalRoot(this.settings.externalRootPath);
    const verifyReport = buildVerifyReport(vaultScan, externalScan);
    this.logScanWarnings(verifyReport.warnings);

    return {
      externalScan,
      vaultScan,
      verifyReport
    };
  }

  private getActiveFileUuidValue(activeFile: TFile): ExnfFrontmatterValue {
    const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    return getExnfFrontmatterValue(frontmatter);
  }

  private getActiveMarkdownFile(): null | TFile {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.extension !== 'md') {
      return null;
    }

    return activeFile;
  }

  private getExpectedMarkerBlockMessage(
    expectedState: Extract<ExpectedExternalFolderInspection, { kind: 'malformed-marker' | 'mismatched-marker' }>
  ): string {
    if (expectedState.kind === 'malformed-marker') {
      return `Derived external folder marker is malformed at ${expectedState.markerPath}: ${expectedState.message}`;
    }

    return `Derived external folder path is already bound to UUID ${expectedState.markerUuid}: ${expectedState.folderPath}`;
  }

  private getJournalRootPath(): string {
    return buildJournalRootPath({
      configDir: this.app.vault.configDir,
      pluginId: this.manifest.id,
      vaultRootPath: this.getVaultRootPath()
    });
  }

  private getVaultRootPath(): string {
    const adapter = this.app.vault.adapter as Partial<VaultAdapterWithBasePath>;
    if (typeof adapter.getBasePath === 'function') {
      return adapter.getBasePath();
    }

    return this.app.vault.getName();
  }

  private async loadSettings(): Promise<void> {
    const loadedData = (await this.loadData()) as null | Partial<PluginSettings>;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData
    };
  }

  private logError(message: string, error: unknown, details?: Record<string, unknown>): void {
    console.error(LOG_PREFIX, message, {
      ...details,
      error: error instanceof Error
        ? {
          message: error.message,
          name: error.name,
          stack: error.stack
        }
        : error
    });
  }

  private logInfo(message: string, details?: Record<string, unknown>): void {
    console.debug(LOG_PREFIX, message, details ?? {});
  }

  private logScanWarnings(warnings: readonly string[]): void {
    if (warnings.length === 0) {
      return;
    }

    this.logWarn('external root scan completed with warnings', { warnings });
  }

  private logWarn(message: string, details?: Record<string, unknown>): void {
    console.warn(LOG_PREFIX, message, details ?? {});
  }

  private async openBoundExternalFolder(
    folderResult: { created: boolean; folderPath: string; kind: 'bound' },
    notePath: string,
    uuid: string
  ): Promise<void> {
    await openExternalFolderInFileManager(folderResult.folderPath);
    if (folderResult.created) {
      new Notice(`Created and opened external folder for ${notePath}.`);
      this.logInfo('created and opened external folder', {
        folderPath: folderResult.folderPath,
        notePath,
        uuid
      });
      return;
    }

    new Notice(`Opened external folder for ${notePath}.`);
    this.logInfo('opened existing external folder', {
      folderPath: folderResult.folderPath,
      notePath,
      uuid
    });
  }

  private async openDriftedExternalFolder(input: {
    externalScan: ScanContext['externalScan'];
    folderPath: string;
    notePath: string;
    uuid: string;
  }): Promise<void> {
    await openExternalFolderInFileManager(input.folderPath);
    const drift = getActiveFolderDrift({
      externalScan: input.externalScan,
      notePath: input.notePath,
      uuid: input.uuid
    });

    new Notice('Opened existing bound external folder at a non-expected path. Run reconcile when ready.');
    this.logWarn('opened drifted external folder', {
      drift,
      folderPath: input.folderPath,
      notePath: input.notePath,
      uuid: input.uuid
    });
  }

  private openExpectedFolderAdoptionModal(input: {
    expectedFolderPath: string;
    externalRootPath: string;
    notePath: string;
    uuid: string;
  }): void {
    new AdoptExpectedFolderModal(this.app, {
      expectedExternalFolder: toExternalRelativeDisplayPath(input.externalRootPath, input.expectedFolderPath),
      expectedFolderPath: input.expectedFolderPath,
      notePath: input.notePath,
      onConfirm: async (): Promise<void> => {
        await this.runMutatingCommand('adopt an existing external folder', async () => {
          try {
            const result = await writeExpectedMarkerIfUnmarked({
              externalRootPath: input.externalRootPath,
              notePath: input.notePath,
              uuid: input.uuid
            });
            await openExternalFolderInFileManager(result.folderPath);
            new Notice(
              result.markerWritten
                ? `Adopted and opened external folder for ${input.notePath}.`
                : `Opened external folder for ${input.notePath}.`
            );
            this.logInfo('adopted expected external folder marker', {
              folderPath: result.folderPath,
              markerWritten: result.markerWritten,
              notePath: input.notePath,
              uuid: input.uuid
            });
          } catch (error: unknown) {
            this.logError('adopt expected external folder failed', error, {
              expectedFolderPath: input.expectedFolderPath,
              notePath: input.notePath,
              uuid: input.uuid
            });
            throw error;
          }
        });
      },
      uuid: input.uuid
    }).open();
  }

  private async runAssignUuidCommand(): Promise<void> {
    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) {
      new Notice('Open a markdown note to assign an external folder identifier.');
      return;
    }

    await this.runMutatingCommand('assign an external folder UUID', async () => {
      const { verifyReport } = await this.collectScanContext();
      if (verifyReport.hasIntegrityErrors) {
        new Notice('Cannot assign an identifier while integrity errors exist. Review the opened report for details.');
        this.logWarn('assign UUID blocked by integrity errors', { report: verifyReport });
        new VerifyReportModal(this.app, verifyReport, false).open();
        return;
      }

      try {
        const outcome = await assignUuidToNote(this.app, activeFile);
        if (outcome.kind === 'assigned') {
          new Notice(`Assigned external folder identifier to ${activeFile.path}.`);
          this.logInfo('assigned external folder identifier', {
            notePath: activeFile.path,
            uuid: outcome.uuid
          });
          return;
        }

        new Notice(`Note already has an external folder identifier: ${outcome.uuid}`);
        this.logInfo('note already has external folder identifier', {
          notePath: activeFile.path,
          uuid: outcome.uuid
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to assign UUID.';
        new Notice(message);
        this.logError('assign UUID failed', error, { notePath: activeFile.path });
      }
    });
  }

  private async runMutatingCommand(
    actionDescription: string,
    operation: () => Promise<void>
  ): Promise<void> {
    if (this.isMutationInProgress) {
      new Notice(`Cannot ${actionDescription} while another mutating command is already running.`);
      return;
    }

    this.isMutationInProgress = true;
    try {
      await operation();
    } finally {
      this.isMutationInProgress = false;
      this.mutationSequence += 1;
    }
  }

  private async runOpenExternalFolderCommand(): Promise<void> {
    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) {
      new Notice('Open a markdown note to open its external folder.');
      return;
    }

    const exnfValue = this.getActiveFileUuidValue(activeFile);
    if (exnfValue.kind === 'missing') {
      new Notice('This note does not have an external folder identifier. Run Assign external folder identifier first.');
      this.logInfo('open external folder skipped for note without identifier', {
        notePath: activeFile.path
      });
      return;
    }

    if (exnfValue.kind === 'invalid') {
      const initialAction = chooseInitialOpenExternalFolderAction({
        expectedState: null,
        identity: exnfValue
      });
      if (initialAction.kind !== 'block-invalid-identity') {
        throw new Error('Unexpected open external folder action for invalid identity.');
      }

      new Notice(initialAction.message);
      this.logWarn('open external folder blocked by invalid identifier', {
        notePath: activeFile.path,
        reason: exnfValue.reason
      });
      return;
    }

    await this.runMutatingCommand('open an external folder', async () => {
      try {
        const externalRootPath = await resolveExternalRootPath(this.settings.externalRootPath);
        const expectedState = await inspectExpectedExternalFolder({
          externalRootPath,
          notePath: activeFile.path,
          uuid: exnfValue.uuid
        });
        const initialAction = chooseInitialOpenExternalFolderAction({
          expectedState,
          identity: exnfValue
        });

        if (initialAction.kind === 'open-expected') {
          await this.openBoundExternalFolder(
            {
              created: false,
              folderPath: initialAction.folderPath,
              kind: 'bound'
            },
            activeFile.path,
            initialAction.uuid
          );
          return;
        }

        if (initialAction.kind === 'notice-missing-identity') {
          new Notice('This note does not have an external folder identifier. Run Assign external folder identifier first.');
          return;
        }

        if (initialAction.kind !== 'scan-fallback') {
          throw new Error('Unexpected open external folder action after expected-folder inspection.');
        }

        const { externalScan, verifyReport } = await this.collectScanContext();
        const fallbackAction = chooseOpenExternalFolderFallbackAction({
          expectedState: initialAction.expectedState,
          hasIntegrityErrors: verifyReport.hasIntegrityErrors,
          matchingFolderPath: externalScan.bindings.get(initialAction.uuid) ?? null,
          uuid: initialAction.uuid
        });

        if (fallbackAction.kind === 'open-drifted') {
          await this.openDriftedExternalFolder({
            externalScan,
            folderPath: fallbackAction.folderPath,
            notePath: activeFile.path,
            uuid: fallbackAction.uuid
          });
          return;
        }

        if (fallbackAction.kind === 'block-integrity-errors') {
          new Notice('Cannot create or adopt an external folder while integrity errors exist. Review the opened report for details.');
          this.logWarn('external folder creation blocked by integrity errors', {
            notePath: activeFile.path,
            report: verifyReport,
            uuid: fallbackAction.uuid
          });
          new VerifyReportModal(this.app, verifyReport, false).open();
          return;
        }

        if (fallbackAction.kind === 'create-expected') {
          const folderResult = await ensureExpectedBoundExternalFolder({
            createIfMissing: true,
            externalRootPath: externalScan.rootPath,
            notePath: activeFile.path,
            uuid: fallbackAction.uuid
          });
          if (folderResult.kind === 'missing') {
            throw new Error('Expected external folder was not created.');
          }

          await this.openBoundExternalFolder(folderResult, activeFile.path, fallbackAction.uuid);
          return;
        }

        if (fallbackAction.kind === 'prompt-adopt-expected') {
          this.openExpectedFolderAdoptionModal({
            expectedFolderPath: fallbackAction.folderPath,
            externalRootPath: externalScan.rootPath,
            notePath: activeFile.path,
            uuid: fallbackAction.uuid
          });
          return;
        }

        throw new Error(this.getExpectedMarkerBlockMessage(fallbackAction.expectedState));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to open external folder.';
        new Notice(message);
        this.logError('open external folder failed', error, { notePath: activeFile.path });
      }
    });
  }

  private async runReconcileCommand(): Promise<void> {
    this.logInfo('reconcile dry-run started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const { externalScan, vaultScan } = await this.collectScanContext();
    const plan = buildReconcilePlan({
      externalScan,
      mutationSequence: this.mutationSequence,
      vaultScan
    });

    new Notice(`Reconcile dry-run complete: ${plan.summaryText}.`);
    this.logInfo('reconcile dry-run complete', { plan });
    new ReconcilePlanModal(
      this.app,
      plan,
      async () => {
        try {
          await this.runReconcileExecuteCommand(plan);
        } catch (error: unknown) {
          this.showUnexpectedError(error);
        }
      },
      this.settings.dryRunByDefault
    ).open();
  }

  private async runReconcileExecuteCommand(plan: ReturnType<typeof buildReconcilePlan>): Promise<void> {
    await this.runMutatingCommand('execute reconcile', async () => {
      if (plan.hasGlobalErrors) {
        new Notice('Cannot execute reconcile while integrity errors exist. Review the dry-run plan for details.');
        this.logWarn('reconcile execution blocked by global errors', { plan });
        return;
      }

      if (plan.mutationSequence !== this.mutationSequence) {
        new Notice('Cannot execute reconcile from a stale dry-run plan. Run reconcile again.');
        this.logWarn('reconcile execution blocked by stale plan', {
          currentMutationSequence: this.mutationSequence,
          planMutationSequence: plan.mutationSequence
        });
        return;
      }

      const result = await executeReconcilePlan({
        journalRootPath: this.getJournalRootPath(),
        plan
      });
      if (result.succeeded) {
        new Notice(`Reconcile execution complete. Journal: ${result.journalPath}`);
        this.logInfo('reconcile execution complete', { result });
        return;
      }

      new Notice(`Reconcile stopped after a failed move. Journal: ${result.journalPath}`);
      this.logWarn('reconcile execution stopped after failure', { result });
    });
  }

  private async runReportExternalFolderDriftCommand(): Promise<void> {
    this.logInfo('drift report started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const { externalScan, vaultScan } = await this.collectScanContext();
    const driftReport = buildDriftReport(vaultScan, externalScan);
    new Notice(`External folder drift report complete: ${driftReport.summaryText}.`);
    this.logInfo('drift report complete', { report: driftReport });
    new DriftReportModal(this.app, driftReport).open();
  }

  private showUnexpectedError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Command failed.';
    new Notice(message);
    this.logError('command failed unexpectedly', error);
  }
}
