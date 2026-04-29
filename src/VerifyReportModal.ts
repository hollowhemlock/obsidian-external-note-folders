import { Modal } from 'obsidian';

import type {
  VerifyReport,
  VerifyTableRow
} from './core/verify.ts';

export class VerifyReportModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly verifyReport: VerifyReport,
    private readonly resultsMayBeStale: boolean
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Verify external folders' });
    contentEl.createEl('p', {
      text: this.verifyReport.summaryText
    });

    if (this.resultsMayBeStale) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Results may not reflect an in-progress mutation.'
      });
    }

    if (this.verifyReport.classificationOmitted) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: 'Availability and orphan status were omitted because the external root scan reported access errors.'
      });
    }

    this.renderTextSection(contentEl, 'Errors', this.verifyReport.errors, 'No integrity errors detected.');
    this.renderTableSection(contentEl, 'Warnings', this.verifyReport.warningRows, 'No orphan bound folders detected.');
    this.renderTableSection(contentEl, 'Unavailable', this.verifyReport.unavailableRows, 'No missing bound folders detected.');
    this.renderTableSection(contentEl, 'OK', this.verifyReport.okRows, 'No healthy bindings were discovered.');
  }

  private renderTableSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly VerifyTableRow[],
    emptyMessage: string
  ): void {
    containerEl.createEl('h3', { text: title });
    if (rows.length === 0) {
      containerEl.createEl('p', { text: emptyMessage });
      return;
    }

    const tableEl = containerEl.createEl('table');
    tableEl.addClass('external-note-folders-verify-table');

    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'External folder' });
    headerRowEl.createEl('th', { text: 'UUID' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.notePath ?? '-' });
      rowEl.createEl('td', { text: row.externalFolder ?? '-' });
      rowEl.createEl('td', { text: row.uuid });
    }
  }

  private renderTextSection(
    containerEl: HTMLElement,
    title: string,
    items: readonly string[],
    emptyMessage: string
  ): void {
    containerEl.createEl('h3', { text: title });
    if (items.length === 0) {
      containerEl.createEl('p', { text: emptyMessage });
      return;
    }

    const listEl = containerEl.createEl('ul');
    for (const item of items) {
      listEl.createEl('li', { text: item });
    }
  }
}
