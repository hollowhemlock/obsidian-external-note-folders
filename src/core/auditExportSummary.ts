import type { LeafReportModel } from './leafQuery.ts';

export function buildAuditExportSummary(model: LeafReportModel, filename: string, rowCount: number): string {
  return [
    '# Audit export',
    '',
    `Vault: ${model.vaultRoot}`,
    `External root: ${model.externalRoot}`,
    `Scan: ${model.startedAt} – ${model.finishedAt}`,
    ...(model.verifiedChanges?.length
      ? [
        `Working revision: ${String(model.revision)}. Verified binding updates:`,
        ...model.verifiedChanges.map((change) => `${change.verifiedAt}: ${change.folders.join(', ')}`),
        'Original discovery scope and scan time are retained. Other locations were not necessarily rechecked.'
      ]
      : []),
    ...(model.scanSummary ? [model.scanSummary] : []),
    ...(model.uncheckedBindings ?? []),
    ...(model.statusScanMode ? (model.coverage?.issues ?? []).map((issue) => `${issue.location}: ${issue.reason}`) : []),
    '',
    `Coverage: **${model.uncheckedCount > 0 ? 'incomplete' : 'complete'}**. Unchecked items: ${String(model.uncheckedCount)}.`,
    ...(model.templateExclusionSummary ? [model.templateExclusionSummary] : []),
    ...(model.uncheckedCount > 0
      ? ['Unscanned areas may contain additional results. Identity and absence conclusions are provisional; locally unchecked leaf paths are excluded.']
      : []),
    ...(filename === 'folder-status.csv' || filename === 'filtered-folder-status.csv'
      ? ['Status describes observed binding evidence. The confidence column describes exhaustive scan coverage, independently of displayed binding health.']
      : []),
    ...(model.mutationWarning ? ['', '**Results may not reflect in-progress mutations**.'] : []),
    ...(model.stale ? ['', '**This snapshot predates mutations. Refresh before exporting current results.**'] : []),
    '',
    `[${filename}](${filename}): ${String(rowCount)} rows`,
    ''
  ].join('\n');
}
