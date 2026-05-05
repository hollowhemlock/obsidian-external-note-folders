import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type {
  ReconcileConflictRow,
  ReconcileMoveRow,
  ReconcilePlan,
  ReconcilePlanRow
} from './core/reconcilePlan.ts';

export class ReconcilePlanModal extends Modal {
  private executeArmed: boolean;

  public constructor(
    app: Modal['app'],
    private readonly plan: ReconcilePlan,
    private readonly onExecute: () => Promise<void>,
    private readonly dryRunByDefault: boolean
  ) {
    super(app);
    this.executeArmed = !dryRunByDefault;
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');

    const moveRows = this.plan.rows.filter((row): row is ReconcileMoveRow => row.kind === 'move');
    const conflictRows = this.plan.rows.filter((row): row is ReconcileConflictRow => row.kind === 'conflict');

    contentEl.createEl('h2', { text: 'Reconcile external folders' });
    contentEl.createEl('p', { text: this.plan.summaryText });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.dryRunByDefault
        ? 'Dry-run plan. No vault files, external folders, or marker files have been changed.'
        : 'Execution-ready plan. No files have changed yet; clicking confirm executes the planned moves.'
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `External root: ${this.plan.externalRootPath}`
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'External folders may contain unique files. Execution moves folders, never deletes them, and stops on first failure.'
    });

    this.renderTextSection(contentEl, 'Errors', this.plan.errors, 'No global integrity errors detected.');
    this.renderTextSection(contentEl, 'Warnings', this.plan.warnings, 'No scan warnings detected.');
    this.renderTableSection(contentEl, 'Planned Moves', moveRows, 'No folders need to move.');
    this.renderTableSection(contentEl, 'Conflicts', conflictRows, 'No move conflicts detected.');
    this.renderTableSection(contentEl, 'Other Rows', this.plan.rows.filter((row) => row.kind !== 'move' && row.kind !== 'conflict'), 'No other rows.');

    contentEl.createEl('h3', { text: 'Copyable plan' });
    const reportEl = contentEl.createEl('textarea', {
      cls: 'external-note-folders-report-textarea'
    });
    reportEl.value = this.plan.markdownReport;
    reportEl.readOnly = true;

    const actionsEl = contentEl.createDiv({
      cls: 'external-note-folders-modal-actions'
    });
    new ButtonComponent(actionsEl)
      .setButtonText('Close')
      .onClick(() => {
        this.close();
      });

    const executeButton = new ButtonComponent(actionsEl)
      .setButtonText(this.getExecuteButtonText(moveRows.length))
      .setCta()
      .onClick(() => {
        if (!this.executeArmed) {
          this.executeArmed = true;
          executeButton.setButtonText(this.getExecuteButtonText(moveRows.length));
          return;
        }

        executeButton.setDisabled(true);
        this.onExecute().catch(() => {
          // Errors are surfaced by the plugin command handler.
        }).finally(() => {
          this.close();
        });
      });

    executeButton.setDisabled(this.plan.hasGlobalErrors || moveRows.length === 0);
  }

  private getExecuteButtonText(moveCount: number): string {
    if (this.executeArmed) {
      return `Confirm execute ${String(moveCount)} move(s)`;
    }

    return `Execute ${String(moveCount)} move(s)`;
  }

  private renderTableSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly ReconcilePlanRow[],
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
    headerRowEl.createEl('th', { text: 'Kind' });
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'Current external folder' });
    headerRowEl.createEl('th', { text: 'Target external folder' });
    headerRowEl.createEl('th', { text: 'UUID' });
    headerRowEl.createEl('th', { text: 'Message' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const currentExternalFolder = 'currentExternalFolder' in row ? row.currentExternalFolder : null;
      const targetExternalFolder = 'targetExternalFolder' in row ? row.targetExternalFolder : null;
      const notePath = 'notePath' in row ? row.notePath : null;
      const message = 'message' in row ? row.message : '';
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.kind });
      rowEl.createEl('td', { text: notePath ?? '-' });
      rowEl.createEl('td', { text: currentExternalFolder ?? '-' });
      rowEl.createEl('td', { text: targetExternalFolder ?? '-' });
      rowEl.createEl('td', { text: row.uuid });
      rowEl.createEl('td', { text: message });
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
