import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type { IncompleteAdoptionJournal } from './storage/adoptionExecutor.ts';

import { renderCopyableReport } from './modalReport.ts';

export class AdoptionResumeModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly journal: IncompleteAdoptionJournal,
    private readonly onResume: () => Promise<void>
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');

    contentEl.createEl('h2', { text: 'Resume external folder adoption' });
    contentEl.createEl('p', {
      text: 'An incomplete adoption journal exists. Resume it or inspect the journal before starting a new adoption run.'
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `Journal: ${this.journal.journalPath}`
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `Started: ${this.journal.startedAt}; entries: ${String(this.journal.entryCount)}`
    });
    renderCopyableReport(contentEl, 'Copyable details', this.buildCopyableReport());

    const actionsEl = contentEl.createDiv({
      cls: 'external-note-folders-modal-actions'
    });
    new ButtonComponent(actionsEl)
      .setButtonText('Close')
      .onClick(() => {
        this.close();
      });

    const resumeButton = new ButtonComponent(actionsEl)
      .setButtonText('Resume adoption')
      .setCta()
      .onClick(() => {
        resumeButton.setDisabled(true);
        this.onResume().catch(() => {
          // Errors are surfaced by the plugin command handler.
        }).finally(() => {
          this.close();
        });
      });
  }

  private buildCopyableReport(): string {
    return [
      '# Resume External Folder Adoption',
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Journal | ${this.journal.journalPath} |`,
      `| Started | ${this.journal.startedAt} |`,
      `| Entries | ${String(this.journal.entryCount)} |`
    ].join('\n');
  }
}
