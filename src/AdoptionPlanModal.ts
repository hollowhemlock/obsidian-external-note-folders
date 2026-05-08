import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type {
  AdoptionBlockedNoteRow,
  AdoptionPlan,
  AdoptionPlanRow
} from './core/adoptionPlan.ts';

import { getAdoptionRows } from './core/adoptionPlan.ts';

export class AdoptionPlanModal extends Modal {
  private executeArmed: boolean;

  public constructor(
    app: Modal['app'],
    private readonly plan: AdoptionPlan,
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

    const adoptRows = getAdoptionRows(this.plan);
    const blockedRows = this.plan.rows.filter((row): row is AdoptionBlockedNoteRow => row.kind === 'blocked-note');

    contentEl.createEl('h2', { text: 'Adopt existing external folders' });
    contentEl.createEl('p', { text: this.plan.summaryText });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.dryRunByDefault
        ? 'Dry-run plan. No vault files, external folders, or marker files have been changed.'
        : 'Execution-ready plan. No files have changed yet; clicking confirm writes markers and note frontmatter.'
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: `External root: ${this.plan.externalRootPath}`
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Adoption writes .exnf first, then note frontmatter, journals each row, and stops on first failure.'
    });

    this.renderTextSection(contentEl, 'Errors', this.plan.errors, 'No global adoption blockers detected.');
    this.renderTextSection(contentEl, 'Warnings', this.plan.warnings, 'No adoption warnings detected.');
    this.renderTableSection(contentEl, 'Adoptable Matches', adoptRows, 'No exact note/folder matches found.');
    this.renderTableSection(contentEl, 'Blocked Notes', blockedRows, 'No note collisions detected.');
    this.renderTableSection(contentEl, 'Other Rows', this.plan.rows.filter((row) => row.kind !== 'adopt' && row.kind !== 'blocked-note'), 'No unmatched rows.');

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
      .setButtonText(this.getExecuteButtonText(adoptRows.length))
      .setCta()
      .onClick(() => {
        if (!this.executeArmed) {
          this.executeArmed = true;
          executeButton.setButtonText(this.getExecuteButtonText(adoptRows.length));
          return;
        }

        executeButton.setDisabled(true);
        this.onExecute().catch(() => {
          // Errors are surfaced by the plugin command handler.
        }).finally(() => {
          this.close();
        });
      });

    executeButton.setDisabled(this.plan.hasGlobalErrors || adoptRows.length === 0);
  }

  private getExecuteButtonText(adoptCount: number): string {
    if (this.executeArmed) {
      return `Confirm adopt ${String(adoptCount)} folder(s)`;
    }

    return `Adopt ${String(adoptCount)} folder(s)`;
  }

  private renderTableSection(
    containerEl: HTMLElement,
    title: string,
    rows: readonly AdoptionPlanRow[],
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
    headerRowEl.createEl('th', { text: 'External folder' });
    headerRowEl.createEl('th', { text: 'Message' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const notePath = 'notePath' in row ? row.notePath : null;
      const externalFolder = 'externalFolder' in row ? row.externalFolder : null;
      const message = 'message' in row ? row.message : '';
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.kind });
      rowEl.createEl('td', { text: notePath ?? '-' });
      rowEl.createEl('td', { text: externalFolder ?? '-' });
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
