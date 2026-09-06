export interface ReportContext {
  externalRootPath: string;
  vaultPath: string;
}

export function formatCopyableReport(context: ReportContext, reportText: string): string {
  return `${formatReportContext(context)}\n\n${reportText}`;
}

export function formatReportContext(context: ReportContext): string {
  return [
    'vault-path:',
    context.vaultPath,
    'external-root:',
    context.externalRootPath
  ].join('\n');
}

export function renderCopyableReport(
  containerEl: HTMLElement,
  title: string,
  reportText: string,
  context: ReportContext
): void {
  containerEl.createEl('h3', { text: title });
  const reportEl = containerEl.createEl('textarea', {
    cls: 'external-note-folders-report-textarea'
  });
  reportEl.setAttribute('aria-label', title);
  reportEl.value = formatCopyableReport(context, reportText);
  reportEl.readOnly = true;
}

export function renderReportContext(containerEl: HTMLElement, context: ReportContext): void {
  containerEl.createEl('pre', {
    cls: 'external-note-folders-report-context',
    text: formatReportContext(context)
  });
}
