import {
  Notice,
  Plugin as ObsidianPlugin,
  TFile
} from 'obsidian';

import type { CommandProgressOptions } from './CommandProgressModal.ts';
import type { AdoptionPlan } from './core/adoptionPlan.ts';
import type { ExnfFrontmatterValue } from './core/frontmatter.ts';
import type {
  OpenExternalFolderRecoveryPlan,
  OpenRecoveryCandidateRow
} from './core/openExternalFolderRecovery.ts';
import type { SetupPlan } from './core/setupPlan.ts';
import type { ReportContext } from './modalReport.ts';
import type { PluginSettings } from './PluginSettings.ts';
import type { AdoptionExecutionOperations } from './storage/adoptionExecutor.ts';
import type {
  SetupExecutionOperations,
  SetupJournal
} from './storage/setupExecutor.ts';

import { AdoptionPlanModal } from './AdoptionPlanModal.ts';
import { AdoptionResumeModal } from './AdoptionResumeModal.ts';
import { CommandProgressModal } from './CommandProgressModal.ts';
import {
  buildExactPathAdoptionPlan,
  buildExactPathCandidateIdentities,
  haveSameAdoptionRows
} from './core/adoptionPlan.ts';
import { buildDriftReport } from './core/driftReport.ts';
import { getExnfFrontmatterValue } from './core/frontmatter.ts';
import {
  buildExistingIdentifiedNoteTargets,
  findIdentifiedNoteConflict
} from './core/identifiedNoteTargets.ts';
import {
  buildMarkerMigrationPlan,
  haveSameMarkerMigrationRows
} from './core/markerMigrationPlan.ts';
import { buildMovedFolderSuggestionReport } from './core/movedFolderSuggestions.ts';
import { chooseInitialOpenExternalFolderAction } from './core/openExternalFolderFlow.ts';
import { buildOpenExternalFolderRecoveryPlan } from './core/openExternalFolderRecovery.ts';
import { normalizePathForIdentity } from './core/pathPolicy.ts';
import {
  DEFAULT_PROGRESS_MODAL_MIN_VISIBLE_MS,
  waitForMinimumVisibleDuration
} from './core/progressTiming.ts';
import { buildReconcilePlan } from './core/reconcilePlan.ts';
import {
  buildSetupPlan,
  haveSameSetupPlan,
  validateSetupMarkerUniqueness,
  validateSetupRestoration
} from './core/setupPlan.ts';
import {
  assertBindingNoteAllowed,
  buildTemplateExclusionMatcher
} from './core/templateExclusions.ts';
import { generateUnusedCanonicalUuid } from './core/uuid.ts';
import { buildVerifyReport } from './core/verify.ts';
import { DriftReportModal } from './DriftReportModal.ts';
import { MarkerMigrationPlanModal } from './MarkerMigrationPlanModal.ts';
import { MovedFolderSuggestionModal } from './MovedFolderSuggestionModal.ts';
import { assignUuidToNote } from './obsidian/assignUuidToNote.ts';
import { GroupAdoptionController } from './obsidian/GroupAdoptionController.ts';
import {
  LEAF_REPORT_VIEW_TYPE,
  LeafReportTab
} from './obsidian/LeafReportTab.ts';
import { openPluginSettings } from './obsidian/openPluginSettings.ts';
import { scanVault } from './obsidian/scanVault.ts';
import {
  assertNoteUuidMatches,
  writeUuidToNoteIfMissing
} from './obsidian/writeUuidToNote.ts';
import { OpenRecoveryModal } from './OpenRecoveryModal.ts';
import {
  buildRecoveryDetails,
  describeRecoveryReason,
  RECOVERY_SEARCH_DESCRIPTION,
  RECOVERY_SEARCH_FOOTER
} from './openRecoveryPresentation.ts';
import { DEFAULT_SETTINGS } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { ReconcilePlanModal } from './ReconcilePlanModal.ts';
import { SetupPlanModal } from './SetupPlanModal.ts';
import { SetupResumeModal } from './SetupResumeModal.ts';
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
  buildMarkerMigrationJournalRootPath,
  buildSetupJournalRootPath
} from './storage/journalPath.ts';
import { executeMarkerMigrationPlan } from './storage/markerMigrationExecutor.ts';
import { executeReconcilePlan } from './storage/reconcileExecutor.ts';
import { scanExternalRoot } from './storage/scanExternalRoot.ts';
import {
  executeSetupPlan,
  listIncompleteSetupJournals,
  resumeSetupJournal
} from './storage/setupExecutor.ts';
import {
  assertSetupMarkerWriteReady,
  createSetupTargetExclusively,
  inspectSetupTarget
} from './storage/setupTarget.ts';

interface ExactPathAdoptionAnalysis {
  movedSuggestionCount: null | number;
  plan: AdoptionPlan;
}

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

  private groupAdoption: GroupAdoptionController | undefined;
  private isMutationInProgress = false;
  private lastTemplatePatterns = '[]';
  private mutationActivitySequence = 0;
  private mutationSequence = 0;
  private settingsTab: PluginSettingsTab | undefined;

  public override async onload(): Promise<void> {
    await this.loadSettings();
    this.groupAdoption = new GroupAdoptionController(this.app, this.manifest.id, {
      changed: (folder, note): void => {
        for (const leaf of this.app.workspace.getLeavesOfType(LEAF_REPORT_VIEW_TYPE)) {
          if (leaf.view instanceof LeafReportTab) {
            leaf.view.markAdopted(folder, note);
          }
        }
      },
      mutate: async (operation): Promise<void> => {
        if (this.isMutationInProgress) {
          throw new Error('Another mutation is running. Try again when it finishes.');
        }
        await this.runMutatingCommand('adopt folder group', operation);
      },
      sequence: (): number => this.mutationSequence,
      settings: (): PluginSettings => this.settings
    });
    this.register(() => this.groupAdoption?.dispose());
    this.addCommand({
      callback: () => {
        this.groupAdoption?.showRecovery().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'resume-folder-adoption',
      name: 'Resume folder adoption…'
    });
    this.registerView(LEAF_REPORT_VIEW_TYPE, (leaf) =>
      new LeafReportTab(leaf, {
        adopt: (folder): void => this.groupAdoption?.open(folder),
        externalRoot: (): string => this.settings.externalRootPath,
        mutationState: (): { active: boolean; activity: number; sequence: number } => ({
          active: this.isMutationInProgress,
          activity: this.mutationActivitySequence,
          sequence: this.mutationSequence
        }),
        openTemplateSettings: (): void => {
          openPluginSettings(this.app, this.manifest.id);
          this.settingsTab?.focusTemplatePatterns();
        },
        pending: async (): Promise<number> => (await this.groupAdoption?.pending())?.length ?? 0,
        repair: async (folder, direction): Promise<void> => this.groupAdoption?.repair(folder, direction),
        resume: async (): Promise<void> => this.groupAdoption?.showRecovery(),
        scanPatterns: (): string[] => this.settings.statusSkipIgnored ? [...(this.settings.statusIgnorePatterns ?? [])] : [],
        templatePatterns: (): string[] => [...(this.settings.templateExcludePatterns ?? [])]
      }));
    this.register(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(LEAF_REPORT_VIEW_TYPE)) {
        if (leaf.view instanceof LeafReportTab) {
          leaf.view.shutdown();
        }
      }
      this.app.workspace.detachLeavesOfType(LEAF_REPORT_VIEW_TYPE);
    });
    this.addCommand({
      callback: () => {
        this.openLeafReport().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'explore-unmarked-external-leaf-folders',
      name: 'External folder status'
    });

    this.settingsTab = new PluginSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

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
        this.runSetupExternalFolderCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'setup-external-folder',
      name: 'Set up external folder'
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
        this.runAdoptExactPathExternalFoldersCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'adopt-existing-external-folders',
      name: 'Adopt exact-path external folders'
    });

    this.addCommand({
      callback: () => {
        this.runSuggestMovedExternalFolderMatchesCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'suggest-moved-external-folder-matches',
      name: 'Suggest moved external folder matches'
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
    const templatePatterns = JSON.stringify(this.settings.templateExcludePatterns ?? []);
    if (templatePatterns !== this.lastTemplatePatterns) {
      this.mutationSequence++;
      this.lastTemplatePatterns = templatePatterns;
    }
    await this.saveData(this.settings);
  }

  private async assertSetupJournalTargetSafe(journal: SetupJournal): Promise<void> {
    assertBindingNoteAllowed(journal.notePath, this.settings.templateExcludePatterns);
    const inspection = await inspectSetupTarget({
      externalRootPath: journal.externalRootPath,
      ignorePatterns: this.settings.externalRootIgnorePatterns,
      notePath: journal.notePath
    });
    if (!isSetupResumeTargetSafe(inspection, journal, scanVault(this.app, this.settings.templateExcludePatterns))) {
      throw new Error('Expected folder topology, marker identity, or vault UUID ownership changed before setup could continue.');
    }
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
        assertBindingNoteAllowed(row.notePath, this.settings.templateExcludePatterns);
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

  private async buildExactPathAdoptionAnalysis(): Promise<ExactPathAdoptionAnalysis> {
    const { externalScan, vaultScan } = await this.collectScanContext();
    const notePaths = this.getMarkdownNotePaths();
    const exactCandidateIdentities = buildExactPathCandidateIdentities({
      externalScan,
      notePaths,
      vaultScan
    });
    const plan = buildExactPathAdoptionPlan({
      externalScan,
      mutationSequence: this.mutationSequence,
      notePaths,
      vaultScan
    });
    const suggestionReport = buildMovedFolderSuggestionReport({
      exactCandidateIdentities,
      externalScan,
      notePaths,
      vaultScan
    });
    return {
      movedSuggestionCount: suggestionReport.classificationOmitted
        ? null
        : suggestionReport.summary.uniqueSuggestions,
      plan
    };
  }

  private buildSetupExecutionOperations(): SetupExecutionOperations {
    return {
      assertComplete: async (journal): Promise<void> => {
        await this.assertSetupJournalTargetSafe(journal);
        await assertNoteUuidMatches(this.app, this.getMarkdownFileByPath(journal.notePath), journal.uuid);
      },
      createFolder: async (journal, resume): Promise<void> => {
        assertBindingNoteAllowed(journal.notePath, this.settings.templateExcludePatterns);
        await createSetupTargetExclusively(journal.externalRootPath, journal.targetPath, resume);
      },
      writeMarker: async (journal): Promise<void> => {
        await this.assertSetupJournalTargetSafe(journal);
        await assertSetupMarkerWriteReady({
          allowPayload: journal.action === 'confirm-unmarked-adoption',
          targetPath: journal.targetPath,
          uuid: journal.uuid
        });
        await writeExpectedMarkerIfMissingOrMatching({
          externalRootPath: journal.externalRootPath,
          notePath: journal.notePath,
          uuid: journal.uuid
        });
      },
      writeNoteUuid: async (journal): Promise<void> => {
        await this.assertSetupJournalTargetSafe(journal);
        await writeUuidToNoteIfMissing(this.app, this.getMarkdownFileByPath(journal.notePath), journal.uuid);
      }
    };
  }

  private async buildSetupPlanForFile(activeFile: TFile): Promise<SetupPlan> {
    const identity = this.getActiveFileUuidValue(activeFile);
    if (identity.kind !== 'missing') {
      return buildSetupPlan({
        identity,
        inspection: null,
        mutationSequence: this.mutationSequence,
        notePath: activeFile.path,
        notePaths: this.getMarkdownNotePaths(),
        vaultScan: scanVault(this.app, this.settings.templateExcludePatterns)
      });
    }

    const inspection = await inspectSetupTarget({
      externalRootPath: this.settings.externalRootPath,
      ignorePatterns: this.settings.externalRootIgnorePatterns,
      notePath: activeFile.path
    });
    let plan = buildSetupPlan({
      identity,
      inspection,
      mutationSequence: this.mutationSequence,
      notePath: activeFile.path,
      notePaths: this.getMarkdownNotePaths(),
      vaultScan: scanVault(this.app, this.settings.templateExcludePatterns)
    });
    if (plan.action === 'confirm-marker-restore') {
      const externalScan = await this.withProgressModal(
        'Imported marker restoration scan started',
        'Scanning the complete external root to prove the imported UUID is unique.',
        () =>
          scanExternalRoot(inspection.externalRootPath, {
            ignorePatterns: this.settings.externalRootIgnorePatterns
          })
      );
      plan = validateSetupRestoration(plan, externalScan, scanVault(this.app, this.settings.templateExcludePatterns));
    }
    return plan;
  }

  private async collectScanContext(): Promise<ScanContext> {
    const vaultScan = scanVault(this.app, this.settings.templateExcludePatterns);
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

  private generateUnusedVaultUuid(): string {
    const vaultScan = scanVault(this.app, this.settings.templateExcludePatterns);
    const existingUuids = new Set([...vaultScan.bindings.keys(), ...vaultScan.duplicatePaths.keys()]);
    return generateUnusedCanonicalUuid(existingUuids);
  }

  private getActiveFileUuidValue(activeFile: TFile): ExnfFrontmatterValue {
    assertBindingNoteAllowed(activeFile.path, this.settings.templateExcludePatterns);
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
    assertBindingNoteAllowed(notePath, this.settings.templateExcludePatterns);
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile) || file.extension !== 'md') {
      throw new Error(`Markdown note not found: ${notePath}`);
    }

    return file;
  }

  private getMarkdownNotePaths(): string[] {
    const templates = buildTemplateExclusionMatcher(this.settings.templateExcludePatterns);
    return this.app.vault.getMarkdownFiles()
      .map((file) => file.path)
      .filter((notePath) => !templates.ignoresRelativeFilePath(notePath))
      .sort();
  }

  private getMarkerMigrationJournalRootPath(): string {
    return buildMarkerMigrationJournalRootPath({
      configDir: this.app.vault.configDir,
      pluginId: this.manifest.id,
      vaultRootPath: this.getVaultRootPath()
    });
  }

  private getReportContext(externalRootPath: string): ReportContext {
    return {
      externalRootPath,
      vaultPath: this.getVaultRootPath()
    };
  }

  private getSetupJournalRootPath(): string {
    return buildSetupJournalRootPath({
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
      externalRootIgnorePatterns,
      templateExcludePatterns: Array.isArray(loadedData?.templateExcludePatterns)
        ? loadedData.templateExcludePatterns.filter((pattern): pattern is string => typeof pattern === 'string')
        : []
    };
    this.lastTemplatePatterns = JSON.stringify(this.settings.templateExcludePatterns ?? []);
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

  private async openLeafReport(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(LEAF_REPORT_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) {
      await leaf.setViewState({ active: true, type: LEAF_REPORT_VIEW_TYPE });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private openRecoveryModal(plan: OpenExternalFolderRecoveryPlan, openedFolderPath: null | string): void {
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
          assertBindingNoteAllowed(plan.notePath, this.settings.templateExcludePatterns);
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
          assertBindingNoteAllowed(plan.notePath, this.settings.templateExcludePatterns);
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
      openedFolderPath,
      plan,
      reportContext: this.getReportContext(plan.externalRootPath)
    }).open();
  }

  private async runAdoptExactPathExternalFoldersCommand(): Promise<void> {
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
        },
        this.getReportContext(journal.externalRootPath)
      ).open();
      return;
    }

    this.logInfo('external folder adoption dry-run started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const analysis = await this.withProgressModal(
      'External folder adoption started',
      'Scanning the vault and external root to build the adoption dry-run plan.',
      () => this.buildExactPathAdoptionAnalysis()
    );
    const { plan } = analysis;
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
      this.settings.dryRunByDefault,
      analysis.movedSuggestionCount,
      this.getReportContext(plan.externalRootPath)
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

      const currentAnalysis = await this.withProgressModal(
        'External folder adoption preflight started',
        'Rescanning the vault and external root before writing marker files or note frontmatter.',
        () => this.buildExactPathAdoptionAnalysis()
      );
      const currentPlan = currentAnalysis.plan;
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
          true,
          currentAnalysis.movedSuggestionCount,
          this.getReportContext(currentPlan.externalRootPath)
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

    const identity = this.getActiveFileUuidValue(activeFile);
    if (identity.kind === 'valid') {
      new Notice(`Note already has an external folder identifier: ${identity.uuid}`);
      this.logInfo('note already has external folder identifier', {
        notePath: activeFile.path,
        uuid: identity.uuid
      });
      return;
    }
    if (identity.kind === 'invalid') {
      new Notice(`Cannot assign UUID because exnf frontmatter ${identity.reason}.`);
      return;
    }

    await this.runMutatingCommand('assign an external folder UUID', async () => {
      try {
        const vaultScan = scanVault(this.app, this.settings.templateExcludePatterns);
        const existingUuids = new Set([
          ...vaultScan.bindings.keys(),
          ...vaultScan.duplicatePaths.keys()
        ]);
        const outcome = await assignUuidToNote(this.app, activeFile, { existingUuids });
        if (outcome.kind === 'assigned') {
          new Notice(`Assigned external folder identifier to ${activeFile.path}.`);
          this.logInfo('assigned external folder identifier', {
            notePath: activeFile.path,
            uuid: outcome.uuid
          });
          return;
        }

        new Notice(`Note already has an external folder identifier: ${outcome.uuid}`);
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
          true,
          this.getReportContext(currentPlan.externalRootPath)
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
      this.settings.dryRunByDefault,
      this.getReportContext(plan.externalRootPath)
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
    this.mutationActivitySequence += 1;
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
      new Notice('This note does not have an external folder identifier. Run Set up external folder.');
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
        if (initialAction.additionalMarkerUuids.length > 0) {
          new Notice(
            `Opened the matching external folder, but it also contains marker UUID(s): ${
              initialAction.additionalMarkerUuids.join(', ')
            }. Run Report external folder drift.`
          );
        }
        return;
      }

      if (initialAction.kind === 'notice-missing-identity') {
        new Notice('This note does not have an external folder identifier. Run Assign external folder identifier first.');
        return;
      }

      if (initialAction.kind === 'run-recovery') {
        const plan = await this.withProgressModal(
          'Searching for the external folder',
          `${describeRecoveryReason(initialAction.expectedState)} ${RECOVERY_SEARCH_DESCRIPTION}`,
          async () => {
            const vaultScan = scanVault(this.app, this.settings.templateExcludePatterns);
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
          },
          {
            details: buildRecoveryDetails({
              expectedState: initialAction.expectedState,
              externalRootPath,
              notePath: activeFile.path,
              uuid: initialAction.uuid
            }, 'Searching in'),
            footerText: RECOVERY_SEARCH_FOOTER
          }
        );

        let openedFolderPath: null | string = null;
        if (plan.autoOpenFolderPath) {
          await openExternalFolderInFileManager(plan.autoOpenFolderPath);
          openedFolderPath = plan.autoOpenFolderPath;
          new Notice(`Opened recovered external folder for ${activeFile.path}. Review the opened recovery details.`);
          this.logWarn('opened external folder from recovery scan', { plan });
        } else {
          new Notice(`External folder recovery scan complete: ${plan.summaryText}.`);
          this.logInfo('external folder recovery scan complete', { plan });
        }
        this.openRecoveryModal(plan, openedFolderPath);
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
      this.settings.dryRunByDefault,
      this.getReportContext(plan.externalRootPath)
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

    const { driftReport, externalRootPath } = await this.withProgressModal(
      'External folder drift report started',
      'Scanning the vault and external root to build the drift report.',
      async () => {
        const { externalScan, vaultScan } = await this.collectScanContext();
        return {
          driftReport: buildDriftReport(vaultScan, externalScan),
          externalRootPath: externalScan.rootPath
        };
      }
    );
    new Notice(`External folder drift report complete: ${driftReport.summaryText}.`);
    this.logInfo('drift report complete', { report: driftReport });
    new DriftReportModal(this.app, driftReport, this.getReportContext(externalRootPath)).open();
  }

  private async runSetupExecuteCommand(plan: SetupPlan): Promise<void> {
    await this.runMutatingCommand('set up an external folder', async () => {
      if (plan.mutationSequence !== this.mutationSequence) {
        new Notice('External folder setup changed before execution. Run setup again.');
        return false;
      }
      const activeFile = this.getMarkdownFileByPath(plan.notePath);
      const currentPlan = await this.buildSetupPlanForFile(activeFile);
      if (!haveSameSetupPlan(plan, currentPlan)) {
        new Notice('External folder setup preflight changed. Nothing was written; run setup again.');
        return false;
      }

      const executablePlan = plan.uuid ? plan : { ...plan, uuid: this.generateUnusedVaultUuid() };
      const result = await executeSetupPlan({
        journalRootPath: this.getSetupJournalRootPath(),
        operations: this.buildSetupExecutionOperations(),
        plan: executablePlan
      });
      if (!result.succeeded) {
        new Notice(`External folder setup stopped after a failure. Journal: ${result.journalPath}`);
        this.logWarn('external folder setup stopped after failure', { result });
        return true;
      }
      try {
        await openExternalFolderInFileManager(result.journal.targetPath);
        new Notice(`Set up and opened external folder for ${result.journal.notePath}.`);
      } catch (error: unknown) {
        new Notice(`External folder setup completed, but the folder could not be opened. Journal: ${result.journalPath}`);
        this.logError('external folder setup completed but open failed', error, { result });
      }
      return true;
    });
  }

  private async runSetupExternalFolderCommand(): Promise<void> {
    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) {
      new Notice('Open a markdown note to set up an external folder.');
      return;
    }

    const incompleteJournals = await listIncompleteSetupJournals(this.getSetupJournalRootPath(), activeFile.path);
    if (incompleteJournals.length > 1) {
      new Notice('Multiple incomplete setup journals exist for this note. Inspect the setup journal folder before continuing.');
      return;
    }
    const incompleteJournal = incompleteJournals[0];
    if (incompleteJournal) {
      new SetupResumeModal(this.app, incompleteJournal, async () => {
        try {
          await this.runSetupResumeCommand(incompleteJournal);
        } catch (error: unknown) {
          this.showUnexpectedError(error);
        }
      }, this.getReportContext(incompleteJournal.externalRootPath)).open();
      return;
    }

    const plan = await this.buildSetupPlanForFile(activeFile);
    if (plan.action === 'open-existing') {
      await this.runOpenExternalFolderCommand();
      return;
    }
    if (plan.action === 'block') {
      new Notice('External folder setup is blocked. Review the opened details.');
      new SetupPlanModal(
        this.app,
        plan,
        async () => undefined,
        this.getReportContext(plan.externalRootPath || this.settings.externalRootPath)
      ).open();
      return;
    }
    if (plan.action === 'create-new') {
      await this.runSetupExecuteCommand(plan);
      return;
    }

    new SetupPlanModal(
      this.app,
      plan,
      async () => {
        try {
          await this.runSetupExecuteCommand(plan);
        } catch (error: unknown) {
          this.showUnexpectedError(error);
        }
      },
      this.getReportContext(plan.externalRootPath || this.settings.externalRootPath)
    ).open();
  }

  private async runSetupResumeCommand(journal: { journalPath: string } & SetupJournal): Promise<void> {
    await this.runMutatingCommand('resume external folder setup', async () => {
      const note = this.getMarkdownFileByPath(journal.notePath);
      const identity = this.getActiveFileUuidValue(note);
      if (identity.kind === 'invalid' || (identity.kind === 'valid' && identity.uuid !== journal.uuid)) {
        new Notice('Cannot resume setup because the note identity changed. Inspect the setup journal.');
        return false;
      }
      const vaultScan = scanVault(this.app, this.settings.templateExcludePatterns);
      const ownerPath = vaultScan.bindings.get(journal.uuid);
      if (vaultScan.duplicatePaths.has(journal.uuid) || (ownerPath && ownerPath !== journal.notePath)) {
        new Notice('Cannot resume setup because its UUID now belongs to another vault note.');
        return false;
      }
      const inspection = await inspectSetupTarget({
        externalRootPath: journal.externalRootPath,
        ignorePatterns: this.settings.externalRootIgnorePatterns,
        notePath: journal.notePath
      });
      if (!isSetupResumeTargetSafe(inspection, journal, vaultScan)) {
        new Notice('Cannot resume setup because the expected folder topology changed. Inspect the setup journal.');
        return false;
      }
      if (journal.action === 'confirm-marker-restore') {
        const externalScan = await this.withProgressModal(
          'Imported marker restoration resume scan started',
          'Rescanning the complete external root before restoring note identity.',
          () =>
            scanExternalRoot(journal.externalRootPath, {
              ignorePatterns: this.settings.externalRootIgnorePatterns
            })
        );
        if (validateSetupMarkerUniqueness(journal.uuid, journal.targetPath, externalScan).length > 0) {
          new Notice('Cannot resume marker restoration because UUID uniqueness can no longer be proven.');
          return false;
        }
      }
      const result = await resumeSetupJournal({
        journalPath: journal.journalPath,
        operations: this.buildSetupExecutionOperations()
      });
      if (!result.succeeded) {
        new Notice(`External folder setup resume stopped after a failure. Journal: ${result.journalPath}`);
        return true;
      }
      try {
        await openExternalFolderInFileManager(result.journal.targetPath);
        new Notice(`Resumed setup and opened external folder for ${result.journal.notePath}.`);
      } catch (error: unknown) {
        new Notice(`External folder setup completed, but the folder could not be opened. Journal: ${result.journalPath}`);
        this.logError('resumed setup completed but open failed', error, { result });
      }
      return true;
    });
  }

  private async runSuggestMovedExternalFolderMatchesCommand(): Promise<void> {
    this.logInfo('moved external folder suggestion scan started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });
    const { externalRootPath, report } = await this.withProgressModal(
      'Moved external folder suggestion scan started',
      'Scanning the vault and external root for unique equivalently named paths.',
      async () => {
        const { externalScan, vaultScan } = await this.collectScanContext();
        const notePaths = this.getMarkdownNotePaths();
        return {
          externalRootPath: externalScan.rootPath,
          report: buildMovedFolderSuggestionReport({
            exactCandidateIdentities: buildExactPathCandidateIdentities({ externalScan, notePaths, vaultScan }),
            externalScan,
            notePaths,
            vaultScan
          })
        };
      }
    );
    new Notice(`Moved external folder suggestion scan complete: ${report.summaryText}.`);
    this.logInfo('moved external folder suggestion scan complete', { report });
    new MovedFolderSuggestionModal(this.app, report, this.getReportContext(externalRootPath)).open();
  }

  private showUnexpectedError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Command failed.';
    new Notice(message);
    this.logError('command failed unexpectedly', error);
  }

  private async withProgressModal<T>(
    title: string,
    description: string,
    operation: () => Promise<T>,
    options: CommandProgressOptions = {}
  ): Promise<T> {
    const progressModal = new CommandProgressModal(this.app, title, description, options);
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

function isSetupResumeTargetSafe(
  inspection: Awaited<ReturnType<typeof inspectSetupTarget>>,
  journal: SetupJournal,
  vaultScan: ReturnType<typeof scanVault>
): boolean {
  const reservation = findIdentifiedNoteConflict(
    buildExistingIdentifiedNoteTargets(vaultScan, inspection.externalRootPath, journal.notePath),
    normalizePathForIdentity(inspection.targetPath)
  );
  const requiresMarker = journal.stage === 'frontmatter-write' || journal.stage === 'complete';
  const ownerPath = vaultScan.bindings.get(journal.uuid);
  return inspection.errors.length === 0
    && !vaultScan.duplicatePaths.has(journal.uuid)
    && (!ownerPath || ownerPath === journal.notePath)
    && normalizePathForIdentity(inspection.targetPath) === normalizePathForIdentity(journal.targetPath)
    && !inspection.targetIgnored
    && inspection.ancestorMarkerPaths.length === 0
    && inspection.descendantMarkerPaths.length === 0
    && inspection.skippedDirectories.length === 0
    && !reservation
    && (!requiresMarker || (inspection.targetKind === 'directory' && inspection.targetMarkerUuids.length === 1))
    && inspection.targetMarkerUuids.every((uuid) => uuid === journal.uuid);
}
