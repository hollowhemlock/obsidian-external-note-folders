import {
  Notice,
  Plugin as ObsidianPlugin,
  TFile
} from 'obsidian';

import type { AdoptionPlan } from './core/adoptionPlan.ts';
import type { ExnfFrontmatterValue } from './core/frontmatter.ts';
import type {
  OpenExternalFolderRecoveryPlan,
  OpenRecoveryCandidateRow
} from './core/openExternalFolderRecovery.ts';
import type { PluginSettings } from './PluginSettings.ts';
import type { AdoptionExecutionOperations } from './storage/adoptionExecutor.ts';

import { AdoptionPlanModal } from './AdoptionPlanModal.ts';
import { AdoptionResumeModal } from './AdoptionResumeModal.ts';
import { CommandProgressModal } from './CommandProgressModal.ts';
import {
  buildAdoptionPlan,
  haveSameAdoptionRows
} from './core/adoptionPlan.ts';
import { buildDriftReport } from './core/driftReport.ts';
import { getExnfFrontmatterValue } from './core/frontmatter.ts';
import {
  buildMarkerMigrationPlan,
  haveSameMarkerMigrationRows
} from './core/markerMigrationPlan.ts';
import { chooseInitialOpenExternalFolderAction } from './core/openExternalFolderFlow.ts';
import { buildOpenExternalFolderRecoveryPlan } from './core/openExternalFolderRecovery.ts';
import {
  DEFAULT_PROGRESS_MODAL_MIN_VISIBLE_MS,
  waitForMinimumVisibleDuration
} from './core/progressTiming.ts';
import { buildReconcilePlan } from './core/reconcilePlan.ts';
import { buildVerifyReport } from './core/verify.ts';
import { DriftReportModal } from './DriftReportModal.ts';
import { MarkerMigrationPlanModal } from './MarkerMigrationPlanModal.ts';
import { assignUuidToNote } from './obsidian/assignUuidToNote.ts';
import { scanVault } from './obsidian/scanVault.ts';
import {
  assertNoteUuidMatches,
  writeUuidToNoteIfMissing
} from './obsidian/writeUuidToNote.ts';
import { OpenRecoveryModal } from './OpenRecoveryModal.ts';
import { DEFAULT_SETTINGS } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { ReconcilePlanModal } from './ReconcilePlanModal.ts';
import {
  executeAdoptionPlan,
  listIncompleteAdoptionJournals,
  readAdoptionJournal,
  resumeAdoptionJournal
} from './storage/adoptionExecutor.ts';
import {
  assertExpectedMarkerMatches,
  ensureExpectedBoundExternalFolder,
  inspectExpectedExternalFolder,
  openExternalFolderInFileManager,
  resolveExternalRootPath,
  writeExpectedMarkerIfMissingOrMatching,
  writeExpectedMarkerIfUnmarked,
  writeMarkerToExistingUnmarkedFolder
} from './storage/boundExternalFolder.ts';
import {
  buildAdoptionJournalRootPath,
  buildJournalRootPath,
  buildMarkerMigrationJournalRootPath
} from './storage/journalPath.ts';
import { executeMarkerMigrationPlan } from './storage/markerMigrationExecutor.ts';
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
        this.runAdoptExistingExternalFoldersCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'adopt-existing-external-folders',
      name: 'Adopt existing external folders'
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
        this.runMigrateLegacyMarkersCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'migrate-legacy-marker-files',
      name: 'Migrate legacy marker files'
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

  private async buildAdoptionDryRunPlan(): Promise<AdoptionPlan> {
    const { externalScan, vaultScan } = await this.collectScanContext();
    return buildAdoptionPlan({
      externalScan,
      mutationSequence: this.mutationSequence,
      notePaths: this.getMarkdownNotePaths(),
      vaultScan
    });
  }

  private buildAdoptionExecutionOperations(externalRootPath: string): AdoptionExecutionOperations {
    return {
      assertMarkerMatches: async (row, uuid): Promise<void> => {
        await assertExpectedMarkerMatches({
          externalRootPath,
          notePath: row.notePath,
          uuid
        });
      },
      assertNoteUuidMatches: async (row, uuid): Promise<void> => {
        await assertNoteUuidMatches(this.app, this.getMarkdownFileByPath(row.notePath), uuid);
      },
      writeMarker: async (row, uuid): Promise<void> => {
        await writeExpectedMarkerIfMissingOrMatching({
          externalRootPath,
          notePath: row.notePath,
          uuid
        });
      },
      writeNoteUuid: async (row, uuid): Promise<void> => {
        await writeUuidToNoteIfMissing(this.app, this.getMarkdownFileByPath(row.notePath), uuid);
      }
    };
  }

  private async collectScanContext(): Promise<ScanContext> {
    const vaultScan = scanVault(this.app);
    const externalScan = await scanExternalRoot(this.settings.externalRootPath, {
      ignorePatterns: this.settings.externalRootIgnorePatterns
    });
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

  private getAdoptionJournalRootPath(): string {
    return buildAdoptionJournalRootPath({
      configDir: this.app.vault.configDir,
      pluginId: this.manifest.id,
      vaultRootPath: this.getVaultRootPath()
    });
  }

  private getJournalRootPath(): string {
    return buildJournalRootPath({
      configDir: this.app.vault.configDir,
      pluginId: this.manifest.id,
      vaultRootPath: this.getVaultRootPath()
    });
  }

  private getMarkdownFileByPath(notePath: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile) || file.extension !== 'md') {
      throw new Error(`Markdown note not found: ${notePath}`);
    }

    return file;
  }

  private getMarkdownNotePaths(): string[] {
    return this.app.vault.getMarkdownFiles()
      .map((file) => file.path)
      .sort();
  }

  private getMarkerMigrationJournalRootPath(): string {
    return buildMarkerMigrationJournalRootPath({
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
    const externalRootIgnorePatterns = Array.isArray(loadedData?.externalRootIgnorePatterns)
      ? loadedData.externalRootIgnorePatterns
        .filter((pattern): pattern is string => typeof pattern === 'string')
      : DEFAULT_SETTINGS.externalRootIgnorePatterns;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData,
      externalRootIgnorePatterns
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

  private openRecoveryModal(plan: OpenExternalFolderRecoveryPlan): void {
    new OpenRecoveryModal(this.app, {
      onAdoptCandidate: async (row: OpenRecoveryCandidateRow): Promise<void> => {
        await this.runMutatingCommand('adopt an exact-name candidate external folder', async () => {
          const result = await writeMarkerToExistingUnmarkedFolder({
            externalRootPath: plan.externalRootPath,
            folderPath: row.folderPath,
            uuid: plan.uuid
          });
          await openExternalFolderInFileManager(result.folderPath);
          new Notice(`Adopted and opened external folder for ${plan.notePath}.`);
          this.logInfo('adopted recovery candidate external folder', {
            folderPath: result.folderPath,
            notePath: plan.notePath,
            uuid: plan.uuid
          });
        });
      },
      onAdoptExpected: async (): Promise<void> => {
        await this.runMutatingCommand('adopt the expected external folder', async () => {
          const result = await writeExpectedMarkerIfUnmarked({
            externalRootPath: plan.externalRootPath,
            notePath: plan.notePath,
            uuid: plan.uuid
          });
          await openExternalFolderInFileManager(result.folderPath);
          new Notice(`Adopted and opened external folder for ${plan.notePath}.`);
          this.logInfo('adopted expected external folder marker', {
            folderPath: result.folderPath,
            notePath: plan.notePath,
            uuid: plan.uuid
          });
        });
      },
      onCreateExpected: async (): Promise<void> => {
        await this.runMutatingCommand('create the expected external folder', async () => {
          const folderResult = await ensureExpectedBoundExternalFolder({
            createIfMissing: true,
            externalRootPath: plan.externalRootPath,
            notePath: plan.notePath,
            uuid: plan.uuid
          });
          if (folderResult.kind === 'missing') {
            throw new Error('Expected external folder was not created.');
          }

          await this.openBoundExternalFolder(folderResult, plan.notePath, plan.uuid);
        });
      },
      onOpenFolder: async (folderPath: string): Promise<void> => {
        await openExternalFolderInFileManager(folderPath);
        new Notice(`Opened external folder for ${plan.notePath}.`);
        this.logInfo('opened recovery external folder', {
          folderPath,
          notePath: plan.notePath,
          uuid: plan.uuid
        });
      },
      plan
    }).open();
  }

  private async runAdoptExistingExternalFoldersCommand(): Promise<void> {
    const incompleteJournals = await listIncompleteAdoptionJournals(this.getAdoptionJournalRootPath());
    if (incompleteJournals.length > 1) {
      new Notice('Multiple incomplete adoption journals exist. Inspect the journal folder before resuming adoption.');
      this.logWarn('adoption blocked by multiple incomplete journals', { incompleteJournals });
      return;
    }

    if (incompleteJournals.length === 1) {
      const journal = incompleteJournals[0];
      if (!journal) {
        throw new Error('Unable to load incomplete adoption journal.');
      }

      new AdoptionResumeModal(
        this.app,
        journal,
        async () => {
          try {
            await this.runAdoptionResumeCommand(journal.journalPath);
          } catch (error: unknown) {
            this.showUnexpectedError(error);
          }
        }
      ).open();
      return;
    }

    this.logInfo('external folder adoption dry-run started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const plan = await this.withProgressModal(
      'External folder adoption started',
      'Scanning the vault and external root to build the adoption dry-run plan.',
      () => this.buildAdoptionDryRunPlan()
    );
    new Notice(`External folder adoption dry-run complete: ${plan.summaryText}.`);
    this.logInfo('external folder adoption dry-run complete', { plan });
    new AdoptionPlanModal(
      this.app,
      plan,
      async () => {
        try {
          await this.runAdoptionExecuteCommand(plan);
        } catch (error: unknown) {
          this.showUnexpectedError(error);
        }
      },
      this.settings.dryRunByDefault
    ).open();
  }

  private async runAdoptionExecuteCommand(plan: AdoptionPlan): Promise<void> {
    await this.runMutatingCommand('execute external folder adoption', async () => {
      if (plan.hasGlobalErrors) {
        new Notice('Cannot execute adoption while global blockers exist. Review the dry-run plan for details.');
        this.logWarn('adoption execution blocked by global errors', { plan });
        return false;
      }

      if (plan.mutationSequence !== this.mutationSequence) {
        new Notice('Cannot execute adoption from a stale dry-run plan. Run adoption again.');
        this.logWarn('adoption execution blocked by stale plan', {
          currentMutationSequence: this.mutationSequence,
          planMutationSequence: plan.mutationSequence
        });
        return false;
      }

      const currentPlan = await this.withProgressModal(
        'External folder adoption preflight started',
        'Rescanning the vault and external root before writing marker files or note frontmatter.',
        () => this.buildAdoptionDryRunPlan()
      );
      if (currentPlan.hasGlobalErrors || !haveSameAdoptionRows(plan, currentPlan)) {
        new Notice('Adoption preflight changed. Review the opened dry-run plan before executing.');
        this.logWarn('adoption execution blocked by changed preflight', {
          currentPlan,
          plan
        });
        new AdoptionPlanModal(
          this.app,
          currentPlan,
          async () => {
            try {
              await this.runAdoptionExecuteCommand(currentPlan);
            } catch (error: unknown) {
              this.showUnexpectedError(error);
            }
          },
          true
        ).open();
        return false;
      }

      const result = await this.withProgressModal(
        'External folder adoption execution started',
        'Writing marker files and note frontmatter. Adoption journals each row and stops on first failure.',
        () =>
          executeAdoptionPlan({
            journalRootPath: this.getAdoptionJournalRootPath(),
            operations: this.buildAdoptionExecutionOperations(currentPlan.externalRootPath),
            plan: currentPlan
          })
      );
      if (result.succeeded) {
        new Notice(`External folder adoption complete. Journal: ${result.journalPath}`);
        this.logInfo('external folder adoption complete', { result });
        return true;
      }

      new Notice(`External folder adoption stopped after a failure. Journal: ${result.journalPath}`);
      this.logWarn('external folder adoption stopped after failure', { result });
      return true;
    });
  }

  private async runAdoptionResumeCommand(journalPath: string): Promise<void> {
    await this.runMutatingCommand('resume external folder adoption', async () => {
      const journal = await readAdoptionJournal(journalPath);
      const result = await this.withProgressModal(
        'External folder adoption resume started',
        'Resuming marker and frontmatter writes from the incomplete adoption journal.',
        () =>
          resumeAdoptionJournal({
            journalPath,
            operations: this.buildAdoptionExecutionOperations(journal.externalRootPath)
          })
      );
      if (result.succeeded) {
        new Notice(`External folder adoption resume complete. Journal: ${result.journalPath}`);
        this.logInfo('external folder adoption resume complete', { result });
        return;
      }

      new Notice(`External folder adoption resume stopped after a failure. Journal: ${result.journalPath}`);
      this.logWarn('external folder adoption resume stopped after failure', { result });
    });
  }

  private async runAssignUuidCommand(): Promise<void> {
    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) {
      new Notice('Open a markdown note to assign an external folder identifier.');
      return;
    }

    await this.runMutatingCommand('assign an external folder UUID', async () => {
      const { verifyReport } = await this.withProgressModal(
        'Assign external folder identifier started',
        'Scanning the external root for integrity errors before writing note frontmatter.',
        () => this.collectScanContext()
      );
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

  private async runMarkerMigrationExecuteCommand(plan: ReturnType<typeof buildMarkerMigrationPlan>): Promise<void> {
    await this.runMutatingCommand('execute legacy marker migration', async () => {
      if (plan.hasGlobalErrors) {
        new Notice('Cannot execute marker migration while blockers exist. Review the dry-run plan for details.');
        this.logWarn('marker migration execution blocked by global errors', { plan });
        return false;
      }

      if (plan.mutationSequence !== this.mutationSequence) {
        new Notice('Cannot execute marker migration from a stale dry-run plan. Run migration again.');
        this.logWarn('marker migration execution blocked by stale plan', {
          currentMutationSequence: this.mutationSequence,
          planMutationSequence: plan.mutationSequence
        });
        return false;
      }

      const currentPlan = await this.withProgressModal(
        'Legacy marker migration preflight started',
        'Rescanning the external root before renaming legacy marker files.',
        async () => {
          const currentExternalScan = await scanExternalRoot(plan.externalRootPath, {
            ignorePatterns: this.settings.externalRootIgnorePatterns
          });
          return buildMarkerMigrationPlan({
            externalScan: currentExternalScan,
            mutationSequence: this.mutationSequence
          });
        }
      );
      if (currentPlan.hasGlobalErrors || !haveSameMarkerMigrationRows(plan, currentPlan)) {
        new Notice('Marker migration preflight changed. Review the opened dry-run plan before executing.');
        this.logWarn('marker migration execution blocked by changed preflight', {
          currentPlan,
          plan
        });
        new MarkerMigrationPlanModal(
          this.app,
          currentPlan,
          async () => {
            try {
              await this.runMarkerMigrationExecuteCommand(currentPlan);
            } catch (error: unknown) {
              this.showUnexpectedError(error);
            }
          },
          true
        ).open();
        return false;
      }

      const result = await this.withProgressModal(
        'Legacy marker migration execution started',
        'Renaming legacy .exnf marker files to <uuid>.exnf files and writing a journal.',
        () =>
          executeMarkerMigrationPlan({
            journalRootPath: this.getMarkerMigrationJournalRootPath(),
            plan: currentPlan
          })
      );
      if (result.succeeded) {
        new Notice(`Legacy marker migration complete. Journal: ${result.journalPath}`);
        this.logInfo('legacy marker migration complete', { result });
        return true;
      }

      new Notice(`Legacy marker migration stopped after a failure. Journal: ${result.journalPath}`);
      this.logWarn('legacy marker migration stopped after failure', { result });
      return true;
    });
  }

  private async runMigrateLegacyMarkersCommand(): Promise<void> {
    this.logInfo('legacy marker migration dry-run started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const plan = await this.withProgressModal(
      'Legacy marker migration started',
      'Scanning the external root to build the legacy marker migration dry-run plan.',
      async () => {
        const externalScan = await scanExternalRoot(this.settings.externalRootPath, {
          ignorePatterns: this.settings.externalRootIgnorePatterns
        });
        return buildMarkerMigrationPlan({
          externalScan,
          mutationSequence: this.mutationSequence
        });
      }
    );

    new Notice(`Legacy marker migration dry-run complete: ${plan.summaryText}.`);
    this.logInfo('legacy marker migration dry-run complete', { plan });
    new MarkerMigrationPlanModal(
      this.app,
      plan,
      async () => {
        try {
          await this.runMarkerMigrationExecuteCommand(plan);
        } catch (error: unknown) {
          this.showUnexpectedError(error);
        }
      },
      this.settings.dryRunByDefault
    ).open();
  }

  private async runMutatingCommand(
    actionDescription: string,
    operation: () => Promise<unknown>
  ): Promise<void> {
    if (this.isMutationInProgress) {
      new Notice(`Cannot ${actionDescription} while another mutating command is already running.`);
      return;
    }

    this.isMutationInProgress = true;
    let shouldAdvanceMutationSequence = true;
    try {
      shouldAdvanceMutationSequence = await operation() !== false;
    } finally {
      this.isMutationInProgress = false;
      if (shouldAdvanceMutationSequence) {
        this.mutationSequence += 1;
      }
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

      if (initialAction.kind === 'run-recovery') {
        const plan = await this.withProgressModal(
          'External folder recovery scan started',
          'Searching the external root for this note UUID and exact-name candidate folders.',
          async () => {
            const vaultScan = scanVault(this.app);
            const externalScan = await scanExternalRoot(externalRootPath, {
              ignorePatterns: this.settings.externalRootIgnorePatterns
            });
            return buildOpenExternalFolderRecoveryPlan({
              expectedState: initialAction.expectedState,
              externalScan,
              notePath: activeFile.path,
              uuid: initialAction.uuid,
              vaultScan
            });
          }
        );

        if (plan.autoOpenFolderPath) {
          await openExternalFolderInFileManager(plan.autoOpenFolderPath);
          new Notice(`Opened recovered external folder for ${activeFile.path}. Review the opened recovery details.`);
          this.logWarn('opened external folder from recovery scan', { plan });
        } else {
          new Notice(`External folder recovery scan complete: ${plan.summaryText}.`);
          this.logInfo('external folder recovery scan complete', { plan });
        }
        this.openRecoveryModal(plan);
        return;
      }

      throw new Error('Unexpected open external folder action after expected-folder inspection.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to open external folder.';
      new Notice(message);
      this.logError('open external folder failed', error, { notePath: activeFile.path });
    }
  }

  private async runReconcileCommand(): Promise<void> {
    this.logInfo('reconcile dry-run started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const plan = await this.withProgressModal(
      'Reconcile dry-run started',
      'Scanning the vault and external root to build the reconcile dry-run plan.',
      async () => {
        const { externalScan, vaultScan } = await this.collectScanContext();
        return buildReconcilePlan({
          externalScan,
          mutationSequence: this.mutationSequence,
          vaultScan
        });
      }
    );

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
        return false;
      }

      if (plan.mutationSequence !== this.mutationSequence) {
        new Notice('Cannot execute reconcile from a stale dry-run plan. Run reconcile again.');
        this.logWarn('reconcile execution blocked by stale plan', {
          currentMutationSequence: this.mutationSequence,
          planMutationSequence: plan.mutationSequence
        });
        return false;
      }

      const result = await this.withProgressModal(
        'Reconcile execution started',
        'Moving external folders according to the reconcile plan and writing a journal.',
        () =>
          executeReconcilePlan({
            journalRootPath: this.getJournalRootPath(),
            plan
          })
      );
      if (result.succeeded) {
        new Notice(`Reconcile execution complete. Journal: ${result.journalPath}`);
        this.logInfo('reconcile execution complete', { result });
        return true;
      }

      new Notice(`Reconcile stopped after a failed move. Journal: ${result.journalPath}`);
      this.logWarn('reconcile execution stopped after failure', { result });
      return true;
    });
  }

  private async runReportExternalFolderDriftCommand(): Promise<void> {
    this.logInfo('drift report started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const driftReport = await this.withProgressModal(
      'External folder drift report started',
      'Scanning the vault and external root to build the drift report.',
      async () => {
        const { externalScan, vaultScan } = await this.collectScanContext();
        return buildDriftReport(vaultScan, externalScan);
      }
    );
    new Notice(`External folder drift report complete: ${driftReport.summaryText}.`);
    this.logInfo('drift report complete', { report: driftReport });
    new DriftReportModal(this.app, driftReport).open();
  }

  private showUnexpectedError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Command failed.';
    new Notice(message);
    this.logError('command failed unexpectedly', error);
  }

  private async withProgressModal<T>(
    title: string,
    description: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const progressModal = new CommandProgressModal(this.app, title, description);
    progressModal.open();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const openedAtMs = Date.now();

    try {
      return await operation();
    } finally {
      await waitForMinimumVisibleDuration({
        minimumVisibleMs: DEFAULT_PROGRESS_MODAL_MIN_VISIBLE_MS,
        now: () => Date.now(),
        openedAtMs,
        sleep: async (durationMs) => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, durationMs);
          });
        }
      });
      progressModal.close();
    }
  }
}
