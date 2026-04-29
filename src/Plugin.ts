import type { TFile } from 'obsidian';

import {
  Notice,
  Plugin as ObsidianPlugin
} from 'obsidian';

import type { PluginSettings } from './PluginSettings.ts';

import {
  buildVerifyReport,
  summarizeVerifyReport
} from './core/verify.ts';
import { assignUuidToNote } from './obsidian/assignUuidToNote.ts';
import { scanVault } from './obsidian/scanVault.ts';
import { DEFAULT_SETTINGS } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import {
  ensureBoundExternalFolder,
  openExternalFolderInFileManager
} from './storage/boundExternalFolder.ts';
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
        this.runVerifyCommand().catch((error: unknown) => {
          this.showUnexpectedError(error);
        });
      },
      id: 'verify-external-folders',
      name: 'Verify external folders'
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
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async collectScanContext(): Promise<ScanContext> {
    const vaultScan = scanVault(this.app);
    const externalScan = await scanExternalRoot(this.settings.externalRootPath);
    return {
      externalScan,
      vaultScan,
      verifyReport: buildVerifyReport(vaultScan, externalScan)
    };
  }

  private getActiveMarkdownFile(): null | TFile {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.extension !== 'md') {
      return null;
    }

    return activeFile;
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

  private logWarn(message: string, details?: Record<string, unknown>): void {
    console.warn(LOG_PREFIX, message, details ?? {});
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
        new Notice('Cannot assign an identifier while integrity errors exist. Run the verify command for details.');
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

    await this.runMutatingCommand('open an external folder', async () => {
      const initialScanContext = await this.collectScanContext();
      if (initialScanContext.verifyReport.hasIntegrityErrors) {
        new Notice('Cannot open an external folder while integrity errors exist. Run the verify command for details.');
        this.logWarn('open external folder blocked by integrity errors', {
          report: initialScanContext.verifyReport
        });
        new VerifyReportModal(this.app, initialScanContext.verifyReport, false).open();
        return;
      }

      try {
        const uuidOutcome = await assignUuidToNote(this.app, activeFile);
        const refreshedScanContext = await this.collectScanContext();
        if (refreshedScanContext.verifyReport.hasIntegrityErrors) {
          new Notice('Cannot create an external folder while integrity errors exist. Run the verify command for details.');
          this.logWarn('external folder creation blocked by refreshed integrity errors', {
            notePath: activeFile.path,
            report: refreshedScanContext.verifyReport,
            uuid: uuidOutcome.uuid
          });
          new VerifyReportModal(this.app, refreshedScanContext.verifyReport, false).open();
          return;
        }

        const folderResult = await ensureBoundExternalFolder({
          existingBindings: refreshedScanContext.externalScan.bindings,
          externalRootPath: refreshedScanContext.externalScan.rootPath,
          notePath: activeFile.path,
          uuid: uuidOutcome.uuid
        });

        await openExternalFolderInFileManager(folderResult.folderPath);
        if (folderResult.created) {
          new Notice(`Created and opened external folder for ${activeFile.path}.`);
          this.logInfo('created and opened external folder', {
            folderPath: folderResult.folderPath,
            notePath: activeFile.path,
            uuid: uuidOutcome.uuid
          });
          return;
        }

        new Notice(`Opened external folder for ${activeFile.path}.`);
        this.logInfo('opened existing external folder', {
          folderPath: folderResult.folderPath,
          notePath: activeFile.path,
          uuid: uuidOutcome.uuid
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to open external folder.';
        new Notice(message);
        this.logError('open external folder failed', error, { notePath: activeFile.path });
      }
    });
  }

  private async runVerifyCommand(): Promise<void> {
    this.logInfo('verify started', {
      externalRootPath: this.settings.externalRootPath,
      vaultRootPath: this.getVaultRootPath()
    });

    const { verifyReport } = await this.collectScanContext();
    new Notice(summarizeVerifyReport(verifyReport));
    this.logInfo('verify complete', { report: verifyReport });
    new VerifyReportModal(this.app, verifyReport, this.isMutationInProgress).open();
  }

  private showUnexpectedError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Command failed.';
    new Notice(message);
    this.logError('command failed unexpectedly', error);
  }
}
