import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type {
  AdoptionAdoptRow,
  AdoptionBlockedNoteRow,
  AdoptionPlan,
  AdoptionPlanRow,
  AdoptionResidualGroup
} from './core/adoptionPlan.ts';

import { getAdoptionRows } from './core/adoptionPlan.ts';
import { renderCopyableReport } from './modalReport.ts';

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
    contentEl.createEl('p', {
      cls: 'external-note-folders-adoption-guidance',
      text:
        'Leaf-first adoption selects only the deepest exact note/folder matches. A folder cannot receive a marker when another candidate or existing binding is below it.'
    });
    contentEl.createEl('p', {
      cls: 'external-note-folders-adoption-guidance',
      text:
        'Confirmation applies to the entire plan. If any selected match looks wrong, close this plan, resolve the path or add an ignore pattern, then run adoption again.'
    });
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
      text: 'Adoption writes <uuid>.exnf first, then note frontmatter, journals each row, and stops on first failure.'
    });

    this.renderTextSection(contentEl, 'Errors', this.plan.errors, 'No global adoption blockers detected.');
    this.renderTextSection(contentEl, 'Warnings', this.plan.warnings, 'No adoption warnings detected.');
    this.renderAdoptableSection(contentEl, adoptRows);
    this.renderTableSection(contentEl, 'Blocked Notes', blockedRows, 'No note collisions detected.');
    this.renderResidualSection(contentEl, this.plan.residualGroups);

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

  private renderAdoptableSection(containerEl: HTMLElement, rows: readonly AdoptionAdoptRow[]): void {
    containerEl.createEl('h3', { text: 'Adoptable matches' });
    if (rows.length === 0) {
      containerEl.createEl('p', { text: 'No exact leaf note/folder matches found.' });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Vault file' });
    headerRowEl.createEl('th', { text: 'Prospective marker' });

    const bodyEl = tableEl.createEl('tbody');
    for (const row of rows) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: row.notePath });
      rowEl.createEl('td', { text: `${row.externalFolder}/<new-uuid>.exnf` });
    }
  }

  private renderResidualSection(containerEl: HTMLElement, groups: readonly AdoptionResidualGroup[]): void {
    containerEl.createEl('h3', { text: 'Residual external tree' });
    if (groups.length === 0) {
      containerEl.createEl('p', { text: 'No residual external directories remain after pruning bindings.' });
      return;
    }

    const tableEl = containerEl.createEl('table', {
      cls: 'external-note-folders-verify-table'
    });
    const headerRowEl = tableEl.createEl('thead').createEl('tr');
    headerRowEl.createEl('th', { text: 'Root branch' });
    headerRowEl.createEl('th', { text: 'Directory count' });
    headerRowEl.createEl('th', { text: 'Samples' });

    const bodyEl = tableEl.createEl('tbody');
    for (const group of groups) {
      const rowEl = bodyEl.createEl('tr');
      rowEl.createEl('td', { text: group.groupPath });
      rowEl.createEl('td', { text: String(group.directoryCount) });
      rowEl.createEl('td', { text: group.samplePaths.join(', ') });
    }
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
