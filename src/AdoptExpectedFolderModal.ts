import {
  ButtonComponent,
  Modal,
  Notice
} from 'obsidian';

import { renderCopyableReport } from './modalReport.ts';

export interface AdoptExpectedFolderModalInput {
  expectedExternalFolder: string;
  expectedFolderPath: string;
  notePath: string;
  onConfirm: () => Promise<void>;
  uuid: string;
}

export class AdoptExpectedFolderModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly input: AdoptExpectedFolderModalInput
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');

    contentEl.createEl('h2', { text: 'Adopt existing external folder' });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The expected external folder already exists but is not marked with .exnf. Confirm only if this folder belongs to the active note.'
    });

    const tableEl = contentEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const bodyEl = tableEl.createEl('tbody');
    this.renderRow(bodyEl, 'Vault file', this.input.notePath);
    this.renderRow(bodyEl, 'Expected external folder', this.input.expectedExternalFolder);
    this.renderRow(bodyEl, 'Full external path', this.input.expectedFolderPath);
    this.renderRow(bodyEl, 'UUID', this.input.uuid);
    renderCopyableReport(contentEl, 'Copyable details', this.buildCopyableReport());

    const actionsEl = contentEl.createDiv({
      cls: 'external-note-folders-modal-actions'
    });
    new ButtonComponent(actionsEl)
      .setButtonText('Cancel')
      .onClick(() => {
        this.close();
      });

    const confirmButton = new ButtonComponent(actionsEl)
      .setButtonText('Write .exnf and open')
      .setCta()
      .onClick(() => {
        confirmButton.setDisabled(true);
        this.input.onConfirm().then(() => {
          this.close();
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Failed to adopt external folder.';
          new Notice(message);
          confirmButton.setDisabled(false);
        });
      });
  }

  private buildCopyableReport(): string {
    return [
      '# Adopt Existing External Folder',
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Vault file | ${this.input.notePath} |`,
      `| Expected external folder | ${this.input.expectedExternalFolder} |`,
      `| Full external path | ${this.input.expectedFolderPath} |`,
      `| UUID | ${this.input.uuid} |`
    ].join('\n');
  }

  private renderRow(bodyEl: HTMLTableSectionElement, label: string, value: string): void {
    const rowEl = bodyEl.createEl('tr');
    rowEl.createEl('th', { text: label });
    rowEl.createEl('td', { text: value });
  }
}
