import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type {
  MovedFolderAmbiguityGroup,
  MovedFolderSuggestion,
  MovedFolderSuggestionGroup,
  MovedFolderSuggestionReport
} from './core/movedFolderSuggestions.ts';
import type { ReportContext } from './modalReport.ts';

import {
  renderCopyableReport,
  renderReportContext
} from './modalReport.ts';

const RENDER_BATCH_SIZE = 100;

export class MovedFolderSuggestionModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly report: MovedFolderSuggestionReport,
    private readonly reportContext: ReportContext
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-wide-modal');
    contentEl.addClass('external-note-folders-moved-folder-suggestion-modal');

    contentEl.createEl('h2', { text: 'Suggest moved external folder matches' });
    renderReportContext(contentEl, this.reportContext);
    contentEl.createEl('p', {
      text:
        'Read-only report: literal note and folder names are compared only when their relative paths diverge. No identifiers are assigned and no files or folders are changed.'
    });
    contentEl.createEl('p', {
      cls: 'external-note-folders-adoption-guidance',
      text: 'Matches are unique only among checked eligible paths. Ignored and skipped subtrees may contain unseen conflicts.'
    });
    contentEl.createEl('p', { text: this.report.summaryText });

    this.renderTextSection(contentEl, 'Errors', this.report.errors, 'No scan errors detected.');
    this.renderTextSection(contentEl, 'Warnings', this.report.warnings, 'No skipped external directories detected.');
    this.renderTextSection(contentEl, 'Notices', this.report.notices, 'No external directories are intentionally excluded.');
    this.renderSuggestionSection(contentEl);
    this.renderAmbiguitySection(contentEl, this.report.ambiguityGroups);

    contentEl.createEl('h3', { text: 'Safe adoption workflow' });
    contentEl.createEl('p', {
      text:
        'Temporarily restore the note to the folder’s matching relative path, run the exact-path adoption command, then move the note to its intended path and run the reconcile command.'
    });
    renderCopyableReport(contentEl, 'Copyable report', this.report.markdownReport, this.reportContext);

    const actionsEl = contentEl.createDiv({ cls: 'external-note-folders-modal-actions' });
    new ButtonComponent(actionsEl).setButtonText('Close').onClick(() => {
      this.close();
    });
  }

  private renderAmbiguitySection(containerEl: HTMLElement, groups: readonly MovedFolderAmbiguityGroup[]): void {
    containerEl.createEl('h3', { text: 'Ambiguous names' });
    if (groups.length === 0) {
      containerEl.createEl('p', { text: 'No ambiguous equivalently named paths found.' });
      return;
    }

    for (const group of groups) {
      const detailsEl = containerEl.createEl('details', {
        cls: 'external-note-folders-moved-ambiguity-group'
      });
      detailsEl.createEl('summary', {
        text: `${group.normalizedName}: ${String(group.noteCount)} note(s), ${String(group.folderCount)} folder(s)`
      });
      detailsEl.createEl('p', { text: `Note samples: ${group.noteSamples.join(', ')}` });
      detailsEl.createEl('p', { text: `Folder samples: ${group.folderSamples.join(', ')}` });
    }
  }

  private renderSuggestionGroup(containerEl: HTMLElement, group: MovedFolderSuggestionGroup): void {
    const detailsEl = containerEl.createEl('details', { cls: 'external-note-folders-moved-suggestion-group' });
    const samples = group.sampleSuggestions.map((suggestion) => suggestion.notePath).join(', ');
    detailsEl.createEl('summary', {
      text: `${group.groupPath}: ${String(group.suggestionCount)} suggestion(s) — ${samples}`
    });

    let renderedCount = 0;
    let tableBody: HTMLTableSectionElement | undefined;
    let moreButton: ButtonComponent | undefined;
    const renderNextBatch = (): void => {
      const nextRows = group.suggestions.slice(renderedCount, renderedCount + RENDER_BATCH_SIZE);
      if (!tableBody) {
        const tableEl = detailsEl.createEl('table', { cls: 'external-note-folders-verify-table' });
        const headerRowEl = tableEl.createEl('thead').createEl('tr');
        headerRowEl.createEl('th', { text: 'Vault note' });
        headerRowEl.createEl('th', { text: 'Expected folder' });
        headerRowEl.createEl('th', { text: 'Equivalently named folder' });
        tableBody = tableEl.createEl('tbody');
      }
      this.renderSuggestionRows(tableBody, nextRows);
      renderedCount += nextRows.length;
      if (renderedCount >= group.suggestions.length) {
        moreButton?.buttonEl.remove();
        moreButton = undefined;
      } else {
        moreButton ??= new ButtonComponent(detailsEl)
          .setButtonText('Show next 100')
          .onClick(renderNextBatch);
      }
    };

    detailsEl.addEventListener('toggle', () => {
      if (detailsEl.open && renderedCount === 0) {
        renderNextBatch();
      }
    });
  }

  private renderSuggestionRows(containerEl: HTMLElement, rows: readonly MovedFolderSuggestion[]): void {
    for (const suggestion of rows) {
      const rowEl = containerEl.createEl('tr');
      rowEl.createEl('td', { text: suggestion.notePath });
      rowEl.createEl('td', { text: suggestion.expectedExternalFolder });
      rowEl.createEl('td', { text: suggestion.candidateExternalFolder });
    }
  }

  private renderSuggestionSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Unique suggestions' });
    if (this.report.classificationOmitted) {
      containerEl.createEl('p', { text: 'Suggestion classification is unavailable because the external-root scan or ignore configuration failed.' });
      return;
    }
    if (this.report.groups.length === 0) {
      containerEl.createEl('p', { text: 'No unique moved-folder suggestions found among checked eligible paths.' });
      return;
    }
    for (const group of this.report.groups) {
      this.renderSuggestionGroup(containerEl, group);
    }
  }

  private renderTextSection(containerEl: HTMLElement, title: string, items: readonly string[], emptyMessage: string): void {
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
