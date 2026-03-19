import { Modal } from 'obsidian';

import type { VerifyReport } from './core/verify.ts';

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

    this.renderSection(contentEl, 'Errors', this.verifyReport.errors, 'No integrity errors detected.');
    this.renderSection(contentEl, 'Warnings', this.verifyReport.warnings, 'No orphan bound folders detected.');
    this.renderSection(contentEl, 'Unavailable', this.verifyReport.unavailable, 'No missing bound folders detected.');
    this.renderSection(contentEl, 'OK', this.verifyReport.ok, 'No healthy bindings were discovered.');
  }

  private renderSection(
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
