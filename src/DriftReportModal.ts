import { Modal } from 'obsidian';

import type {
  DriftBindingRow,
  DriftOccupiedRow,
  DriftReport,
  DriftSuggestion
} from './core/driftReport.ts';

export class DriftReportModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly driftReport: DriftReport
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');

    contentEl.createEl('h2', { text: 'External folder drift report' });
    contentEl.createEl('p', { text: this.driftReport.summaryText });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Read-only report. No vault files, external folders, or marker files were changed.'
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'External folders may contain unique files. Back up the external root before manual repair.'
    });

    this.renderTextSection(contentEl, 'Errors', this.driftReport.errors, 'No integrity errors detected.');
    this.renderBindingSection(contentEl, 'Unexpected Paths', this.driftReport.unexpectedRows, 'No bound folders are at unexpected paths.');
    this.renderBindingSection(contentEl, 'Missing Expected Folders', this.driftReport.missingRows, 'No expected folders are missing.');
    this.renderBindingSection(contentEl, 'Orphan Folders', this.driftReport.orphanRows, 'No orphan bound folders detected.');
    this.renderOccupiedSection(contentEl, 'Occupied Target Paths', this.driftReport.occupiedRows, 'No expected target paths are occupied.');
    this.renderSuggestionSection(contentEl, 'Suggestions', this.driftReport.suggestions, 'No likely matches found.');

    contentEl.createEl('h3', { text: 'Copyable report' });
    const reportEl = contentEl.createEl('textarea', {
      cls: 'external-note-folders-report-textarea'
    });
    reportEl.value = this.driftReport.markdownReport;
    reportEl.readOnly = true;
  }

  private renderBindingSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly DriftBindingRow[],
    emptyMessage: string
  ): void {
    containerEl.createEl('h3', { text: title });
    if (rows.length === 0) {
      containerEl.createEl('p', { text: emptyMessage });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'Expected external folder' });
    headerRowEl.createEl('th', { text: 'Actual external folder' });
    headerRowEl.createEl('th', { text: 'UUID' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.notePath ?? '-' });
      rowEl.createEl('td', { text: row.expectedExternalFolder ?? '-' });
      rowEl.createEl('td', { text: row.actualExternalFolder ?? '-' });
      rowEl.createEl('td', { text: row.uuid });
    }
  }

  private renderOccupiedSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly DriftOccupiedRow[],
    emptyMessage: string
  ): void {
    containerEl.createEl('h3', { text: title });
    if (rows.length === 0) {
      containerEl.createEl('p', { text: emptyMessage });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'Expected external folder' });
    headerRowEl.createEl('th', { text: 'Reason' });
    headerRowEl.createEl('th', { text: 'UUID' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.notePath });
      rowEl.createEl('td', { text: row.expectedExternalFolder });
      rowEl.createEl('td', { text: row.reason });
      rowEl.createEl('td', { text: row.uuid });
    }
  }

  private renderSuggestionSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly DriftSuggestion[],
    emptyMessage: string
  ): void {
    containerEl.createEl('h3', { text: title });
    if (rows.length === 0) {
      containerEl.createEl('p', { text: emptyMessage });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'Expected external folder' });
    headerRowEl.createEl('th', { text: 'Candidate external folder' });
    headerRowEl.createEl('th', { text: 'Confidence' });
    headerRowEl.createEl('th', { text: 'Rationale' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.notePath });
      rowEl.createEl('td', { text: row.expectedExternalFolder });
      rowEl.createEl('td', { text: row.candidateExternalFolder });
      rowEl.createEl('td', { text: row.confidence });
      rowEl.createEl('td', { text: row.rationale });
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
