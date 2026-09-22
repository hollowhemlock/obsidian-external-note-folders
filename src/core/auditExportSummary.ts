import type { LeafReportModel } from './leafQuery.ts';

export function buildAuditExportSummary(model: LeafReportModel, filename: string, rowCount: number): string {
  return [
    '# Audit export',
    '',
    `Vault: ${model.vaultRoot}`,
    `External root: ${model.externalRoot}`,
    `Scan: ${model.startedAt} – ${model.finishedAt}`,
    '',
    `Coverage: **${model.uncheckedCount > 0 ? 'incomplete' : 'complete'}**. Unchecked items: ${String(model.uncheckedCount)}.`,
    ...(model.uncheckedCount > 0
      ? ['Unscanned areas may contain additional results. Identity and absence conclusions are provisional; locally unchecked leaf paths are excluded.']
      : []),
    ...(model.mutationWarning ? ['', '**Results may not reflect in-progress mutations**.'] : []),
    ...(model.stale ? ['', '**This snapshot predates mutations. Refresh before exporting current results.**'] : []),
    '',
    `[${filename}](${filename}): ${String(rowCount)} rows`,
    ''
  ].join('\n');
}
