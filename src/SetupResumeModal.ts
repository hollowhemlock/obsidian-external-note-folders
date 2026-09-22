import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type { ReportContext } from './modalReport.ts';
import type { SetupJournal } from './storage/setupExecutor.ts';

import { renderReportContext } from './modalReport.ts';

export class SetupResumeModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly journal: { journalPath: string } & SetupJournal,
    private readonly onResume: () => Promise<void>,
    private readonly reportContext: ReportContext
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-setup-resume-modal');
    contentEl.createEl('h2', { text: 'Resume external folder setup' });
    renderReportContext(contentEl, this.reportContext);
    contentEl.createEl('p', { text: `Vault file: ${this.journal.notePath}` });
    contentEl.createEl('p', { text: `External folder: ${this.journal.targetPath}` });
    contentEl.createEl('p', { text: `Next step: ${this.journal.stage}` });
    contentEl.createEl('p', { text: `Journal: ${this.journal.journalPath}` });
    if (this.journal.message) {
      contentEl.createEl('p', { text: `Last failure: ${this.journal.message}` });
    }
    new ButtonComponent(contentEl)
      .setButtonText('Resume setup')
      .setCta()
      .onClick(() => {
        this.close();
        this.onResume().catch((error: unknown) => {
          console.error('[external-note-folders] setup resume failed', error);
        });
      });
  }
}
