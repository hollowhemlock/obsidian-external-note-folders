import { Modal } from 'obsidian';

import type { ActiveFolderDrift } from './core/activeFolderDrift.ts';

export class ActiveFolderDriftModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly drift: ActiveFolderDrift
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');

    contentEl.createEl('h2', { text: 'External folder drift detected' });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The active note is already bound to an external folder, but that folder is not at the path currently derived from the note location.'
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'No files were changed. Run reconcile when you are ready to move the external folder.'
    });

    const tableEl = contentEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'Current external folder' });
    headerRowEl.createEl('th', { text: 'Expected external folder' });
    headerRowEl.createEl('th', { text: 'UUID' });

    const rowEl = tableEl.createEl('tbody').createEl('tr');
    rowEl.createEl('td', { text: this.drift.notePath });
    rowEl.createEl('td', { text: this.drift.actualExternalFolder });
    rowEl.createEl('td', { text: this.drift.expectedExternalFolder });
    rowEl.createEl('td', { text: this.drift.uuid });

    contentEl.createEl('h3', { text: 'Copyable report' });
    const reportEl = contentEl.createEl('textarea', {
      cls: 'external-note-folders-report-textarea'
    });
    reportEl.value = [
      '# External Folder Drift',
      '',
      `Vault file: ${this.drift.notePath}`,
      `Current external folder: ${this.drift.actualExternalFolder}`,
      `Expected external folder: ${this.drift.expectedExternalFolder}`,
      `UUID: ${this.drift.uuid}`,
      ''
    ].join('\n');
    reportEl.readOnly = true;
  }
}
