import type { AuditIssue } from './auditTypes.ts';

export interface AdoptionInspectionPolicy {
  externalRoot: string;
  ignorePatterns: string[];
  kind: 'filtered-adoption-v1';
  knownMarkerPaths: string[];
  omissions: { location: string; reason: string }[];
  templatePatterns: string[];
  vaultRoot: string;
}

export function isAdoptionInspectionPolicy(value: unknown): value is AdoptionInspectionPolicy {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<AdoptionInspectionPolicy>;
  return item.kind === 'filtered-adoption-v1'
    && typeof item.externalRoot === 'string' && !!item.externalRoot
    && typeof item.vaultRoot === 'string' && !!item.vaultRoot
    && [item.knownMarkerPaths, item.ignorePatterns, item.templatePatterns].every((list) =>
      Array.isArray(list) && list.every((entry: unknown) => typeof entry === 'string')
    )
    && Array.isArray(item.omissions)
    && item.omissions.every((entry: unknown) =>
      !!entry && typeof entry === 'object' && 'location' in entry && typeof entry.location === 'string'
      && 'reason' in entry && typeof entry.reason === 'string'
    );
}

export function isIntentionalExclusion(
  issue: { code?: AuditIssue['code']; exclusionSource?: AuditIssue['exclusionSource']; scope?: AuditIssue['scope'] }
): boolean {
  return issue.scope === 'external' && !issue.code && !!issue.exclusionSource;
}

export function sameAdoptionScope(a: AdoptionInspectionPolicy, b: AdoptionInspectionPolicy): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
