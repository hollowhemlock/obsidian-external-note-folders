import {
  ButtonComponent,
  Modal,
  Notice
} from 'obsidian';

import type {
  OpenExternalFolderRecoveryPlan,
  OpenRecoveryActiveMatchRow,
  OpenRecoveryCandidateRow
} from './core/openExternalFolderRecovery.ts';

import { renderCopyableReport } from './modalReport.ts';

export interface OpenRecoveryModalInput {
  onAdoptCandidate: (row: OpenRecoveryCandidateRow) => Promise<void>;
  onAdoptExpected: () => Promise<void>;
  onCreateExpected: () => Promise<void>;
  onOpenFolder: (folderPath: string) => Promise<void>;
  plan: OpenExternalFolderRecoveryPlan;
}

export class OpenRecoveryModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly input: OpenRecoveryModalInput
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');

    contentEl.createEl('h2', { text: 'Open external folder recovery' });
    contentEl.createEl('p', { text: this.input.plan.summaryText });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Recovery is scoped to the active note. Full root-wide diagnosis still belongs to drift report and reconcile.'
    });

    this.renderSummary(contentEl);
    this.renderTextSection(contentEl, 'Errors', this.input.plan.errors, 'No blocking recovery errors detected.');
    this.renderTextSection(contentEl, 'Warnings', this.input.plan.warnings, 'No scan warnings detected.');
    this.renderActiveMatches(contentEl);
    this.renderCandidates(contentEl);
    this.renderExpectedActions(contentEl);
    renderCopyableReport(contentEl, 'Copyable report', this.input.plan.markdownReport);
  }

  private renderActiveMatches(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Active UUID matches' });
    if (this.input.plan.activeMatches.length === 0) {
      containerEl.createEl('p', { text: 'No folders with the active note UUID were found.' });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'External folder' });
    headerRowEl.createEl('th', { text: 'UUID' });
    headerRowEl.createEl('th', { text: 'Action' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of this.input.plan.activeMatches) {
      this.renderActiveMatchRow(bodyEl, row);
    }
  }

  private renderActiveMatchRow(bodyEl: HTMLTableSectionElement, row: OpenRecoveryActiveMatchRow): void {
    const rowEl = bodyEl.createEl('tr');
    rowEl.createEl('td', { text: row.externalFolder });
    rowEl.createEl('td', { text: row.uuid });
    const actionEl = rowEl.createEl('td');

    if (this.input.plan.errors.length > 0) {
      actionEl.createSpan({ text: 'Resolve recovery errors before opening.' });
      return;
    }

    if (this.input.plan.activeMatches.length !== 1) {
      actionEl.createSpan({ text: 'Resolve duplicates before opening.' });
      return;
    }

    this.renderAsyncButton(actionEl, 'Open', async () => {
      await this.input.onOpenFolder(row.folderPath);
    });
  }

  private renderAsyncButton(containerEl: HTMLElement, label: string, onClick: () => Promise<void>): void {
    const button = new ButtonComponent(containerEl)
      .setButtonText(label)
      .onClick(() => {
        button.setDisabled(true);
        onClick()
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : `${label} failed.`;
            new Notice(message);
          })
          .finally(() => {
            button.setDisabled(false);
          });
      });
  }

  private renderCandidateRow(bodyEl: HTMLTableSectionElement, row: OpenRecoveryCandidateRow): void {
    const rowEl = bodyEl.createEl('tr');
    rowEl.createEl('td', { text: row.externalFolder });
    rowEl.createEl('td', { text: row.markerStatus });
    rowEl.createEl('td', { text: row.markerUuid ?? '-' });
    rowEl.createEl('td', { text: row.ownerNotePath ?? '-' });
    const actionEl = rowEl.createEl('td');

    if (row.markerStatus !== 'unmarked' || this.input.plan.activeMatches.length > 0 || this.input.plan.errors.length > 0) {
      actionEl.createSpan({ text: row.markerMessage ?? 'Display only.' });
      return;
    }

    this.renderAsyncButton(actionEl, 'Write .exnf and open', async () => {
      await this.input.onAdoptCandidate(row);
      this.close();
    });
  }

  private renderCandidates(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Exact-name candidates' });
    if (this.input.plan.candidateRows.length === 0) {
      containerEl.createEl('p', { text: 'No exact-name candidate folders found.' });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'External folder' });
    headerRowEl.createEl('th', { text: 'Marker status' });
    headerRowEl.createEl('th', { text: 'Marker UUID' });
    headerRowEl.createEl('th', { text: 'Owner note' });
    headerRowEl.createEl('th', { text: 'Action' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of this.input.plan.candidateRows) {
      this.renderCandidateRow(bodyEl, row);
    }
  }

  private renderExpectedActions(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Expected folder action' });
    const actionsEl = containerEl.createDiv({
      cls: 'external-note-folders-modal-actions'
    });

    new ButtonComponent(actionsEl)
      .setButtonText('Cancel')
      .onClick(() => {
        this.close();
      });

    if (this.input.plan.canCreateExpected) {
      this.renderAsyncButton(actionsEl, 'Create expected and open', async () => {
        await this.input.onCreateExpected();
        this.close();
      });
      return;
    }

    if (this.input.plan.canAdoptExpected) {
      this.renderAsyncButton(actionsEl, 'Write expected .exnf and open', async () => {
        await this.input.onAdoptExpected();
        this.close();
      });
      return;
    }

    actionsEl.createSpan({
      text: 'No safe expected-folder action is available from this recovery state.'
    });
  }

  private renderSummary(containerEl: HTMLElement): void {
    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const bodyEl = tableEl.createEl('tbody');
    this.renderSummaryRow(bodyEl, 'Vault file', this.input.plan.notePath);
    this.renderSummaryRow(bodyEl, 'UUID', this.input.plan.uuid);
    this.renderSummaryRow(bodyEl, 'Expected external folder', this.input.plan.expectedExternalFolder);
    this.renderSummaryRow(bodyEl, 'Expected status', this.input.plan.expectedState.kind);
  }

  private renderSummaryRow(bodyEl: HTMLTableSectionElement, label: string, value: string): void {
    const rowEl = bodyEl.createEl('tr');
    rowEl.createEl('th', { text: label });
    rowEl.createEl('td', { text: value });
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
