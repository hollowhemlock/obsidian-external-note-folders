import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type {
  MarkerMigrationPlan,
  MarkerMigrationPlanRow,
  MarkerMigrationRenameRow
} from './core/markerMigrationPlan.ts';

import { renderCopyableReport } from './modalReport.ts';

export class MarkerMigrationPlanModal extends Modal {
  private executeArmed: boolean;

  public constructor(
    app: Modal['app'],
    private readonly plan: MarkerMigrationPlan,
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

    const renameRows = this.plan.rows.filter((row): row is MarkerMigrationRenameRow => row.kind === 'rename');

    contentEl.createEl('h2', { text: 'Migrate legacy marker files' });
    contentEl.createEl('p', { text: this.plan.summaryText });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.dryRunByDefault
        ? 'Dry-run plan. No marker files have been renamed.'
        : 'Execution-ready plan. No files have changed yet; clicking confirm renames legacy markers.'
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `External root: ${this.plan.externalRootPath}`
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Migration renames .exnf to <uuid>.exnf, never overwrites existing UUID-named markers, and writes a journal.'
    });

    this.renderTextSection(contentEl, 'Errors', this.plan.errors, 'No migration blockers detected.');
    this.renderTextSection(contentEl, 'Warnings', this.plan.warnings, 'No scan warnings detected.');
    this.renderTableSection(contentEl, 'Marker Rows', this.plan.rows, 'No legacy markers found.');

    renderCopyableReport(contentEl, 'Copyable plan', this.plan.markdownReport);

    const actionsEl = contentEl.createDiv({
      cls: 'external-note-folders-modal-actions'
    });
    new ButtonComponent(actionsEl)
      .setButtonText('Close')
      .onClick(() => {
        this.close();
      });

    const executeButton = new ButtonComponent(actionsEl)
      .setButtonText(this.getExecuteButtonText(renameRows.length))
      .setCta()
      .onClick(() => {
        if (!this.executeArmed) {
          this.executeArmed = true;
          executeButton.setButtonText(this.getExecuteButtonText(renameRows.length));
          return;
        }

        executeButton.setDisabled(true);
        this.onExecute().catch(() => {
          // Errors are surfaced by the plugin command handler.
        }).finally(() => {
          this.close();
        });
      });

    executeButton.setDisabled(this.plan.hasGlobalErrors || renameRows.length === 0);
  }

  private getExecuteButtonText(renameCount: number): string {
    if (this.executeArmed) {
      return `Confirm migrate ${String(renameCount)} marker(s)`;
    }

    return `Migrate ${String(renameCount)} marker(s)`;
  }

  private renderTableSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly MarkerMigrationPlanRow[],
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
    headerRowEl.createEl('th', { text: 'External folder' });
    headerRowEl.createEl('th', { text: 'UUID' });
    headerRowEl.createEl('th', { text: 'Message' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.kind });
      rowEl.createEl('td', { text: row.externalFolder });
      rowEl.createEl('td', { text: row.uuid });
      rowEl.createEl('td', { text: 'message' in row ? row.message : '' });
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
