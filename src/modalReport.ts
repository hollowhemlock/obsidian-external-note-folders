export function renderCopyableReport(containerEl: HTMLElement, title: string, reportText: string): void {
  containerEl.createEl('h3', { text: title });
  const reportEl = containerEl.createEl('textarea', {
    cls: 'external-note-folders-report-textarea'
  });
  reportEl.setAttribute('aria-label', title);
  reportEl.value = reportText;
  reportEl.readOnly = true;
}
