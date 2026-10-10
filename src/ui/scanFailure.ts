import type { StatusScanMode } from '../core/auditTypes.ts';

export interface ScanContext {
  externalRoot?: string;
  vaultRoot?: string;
}

export interface ScanFailure extends ScanContext {
  affectedPath?: string;
  error: string;
  failedAt: string;
  retainedResults: boolean;
  statusScanMode: StatusScanMode;
}

export function createScanFailure(error: unknown, context: ScanContext, statusScanMode: StatusScanMode, retainedResults: boolean): ScanFailure {
  const details = error as { path?: unknown; root?: unknown } | null;
  const affectedPath = typeof details?.path === 'string' ? details.path : details?.root;
  return {
    ...context,
    ...(typeof affectedPath === 'string' ? { affectedPath } : {}),
    error: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
    retainedResults,
    statusScanMode
  };
}

export function formatScanFailure(failure: ScanFailure): string {
  return [
    'Latest scan attempt: failed',
    `Time: ${failure.failedAt}`,
    `Scan mode: ${failure.statusScanMode}`,
    `Vault: ${displayRoot(failure.vaultRoot)}`,
    `External root: ${displayRoot(failure.externalRoot)}`,
    ...(failure.affectedPath ? [`Affected path: ${failure.affectedPath}`] : []),
    failure.retainedResults ? 'Previous completed results retained; this error belongs to the failed attempt.' : 'No completed scan.',
    '',
    failure.error
  ].join('\n');
}

function displayRoot(value = ''): string {
  return value.length > 0 ? value : 'Unavailable';
}
