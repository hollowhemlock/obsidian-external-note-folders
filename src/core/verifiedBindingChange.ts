// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation for the desktop evidence merger.
import path from 'node:path';

import type { AuditSnapshot } from './auditTypes.ts';

import { normalizePathForIdentity } from './pathPolicy.ts';
import { registerUuidBinding } from './scanResult.ts';

export interface VerifiedBindingChange {
  affectedFolders: string[];
  evidence: AuditSnapshot;
  externalRoot: string;
  ignorePatterns: string[];
  mutationRevision: number;
  newNotePath: string;
  oldNotePath: null | string;
  operationId: string;
  templatePatterns: string[];
  uuid: string;
  vaultRoot: string;
  verifiedAt: string;
}

/** Merge only positive checks. A narrower inspection never changes discovery scope. */
export function mergeVerifiedEvidence(baseline: AuditSnapshot, change: VerifiedBindingChange): AuditSnapshot {
  const fresh = change.evidence;
  if (
    normalizePathForIdentity(baseline.externalRoot) !== normalizePathForIdentity(change.externalRoot)
    || normalizePathForIdentity(baseline.vaultRoot) !== normalizePathForIdentity(change.vaultRoot)
  ) {
    throw new Error('Report roots changed; refresh the report.');
  }
  const checked = new Map(
    (fresh.checkedDirectories ?? []).map((directory) => [
      normalizePathForIdentity(directory.path),
      new Set(directory.entries.map((entry) => normalizePathForIdentity(path.join(directory.path, entry))))
    ])
  );
  function absent(location: string): boolean {
    if (
      fresh.confirmedAbsences?.some((missing) =>
        normalizePathForIdentity(location) === normalizePathForIdentity(missing)
        || normalizePathForIdentity(location).startsWith(normalizePathForIdentity(missing) + path.sep)
      )
    ) {
      return true;
    }
    let current = location;
    while (path.dirname(current) !== current) {
      const parent = path.dirname(current);
      const entries = checked.get(normalizePathForIdentity(parent));
      if (entries && !entries.has(normalizePathForIdentity(current))) {
        return true;
      }
      current = parent;
    }
    return false;
  }
  function merge<T>(old: readonly T[], next: readonly T[], key: (value: T) => string, usable: (value: T) => boolean): T[] {
    const values = new Map(old.filter((value) => !absent(key(value))).map((value) => [normalizePathForIdentity(key(value)), value]));
    for (const value of next) {
      const id = normalizePathForIdentity(key(value));
      if (usable(value) || !values.has(id)) {
        values.set(id, value);
      }
    }
    return [...values.values()];
  }
  const notes = merge(baseline.notes, fresh.notes, (note) => note.notePath, (note) => note.status !== 'unchecked-frontmatter');
  const markers = merge(baseline.markers, fresh.markers, (marker) => marker.markerPath, (marker) => marker.status !== 'unchecked-marker');
  const checkedFiles = new Set([
    ...fresh.notes.filter((note) => note.status !== 'unchecked-frontmatter').map((note) => normalizePathForIdentity(note.notePath)),
    ...fresh.markers.filter((marker) => marker.status !== 'unchecked-marker').map((marker) => normalizePathForIdentity(marker.markerPath))
  ]);
  const issues = [
    ...baseline.issues.filter((issue) =>
      !absent(issue.location)
      && !checkedFiles.has(normalizePathForIdentity(issue.location))
      && !checked.has(normalizePathForIdentity(issue.location))
    ),
    ...fresh.issues.filter((issue) => baseline.statusScanMode !== 'unfiltered' || !issue.exclusionSource)
  ];
  const result: AuditSnapshot = structuredClone({
    ...baseline,
    checkedDirectories: merge(baseline.checkedDirectories ?? [], fresh.checkedDirectories ?? [], (directory) => directory.path, () => true),
    confirmedAbsences: [...(baseline.confirmedAbsences ?? []).filter((location) => !fresh.folders.includes(location)), ...(fresh.confirmedAbsences ?? [])],
    external: {
      ...baseline.external,
      ignoredDirectories: merge(
        baseline.external.ignoredDirectories.filter((directory) => !checked.has(normalizePathForIdentity(directory.folderPath))),
        baseline.statusScanMode === 'unfiltered' ? [] : fresh.external.ignoredDirectories,
        (directory) => directory.folderPath,
        () => true
      )
    },
    folders: [...new Set([...baseline.folders.filter((folder) => !absent(folder)), ...fresh.folders])],
    issues: [...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()],
    markers,
    notes,
    repositoryRoots: [...new Set([...(baseline.repositoryRoots ?? []).filter((folder) => !absent(folder)), ...(fresh.repositoryRoots ?? [])])]
  });
  markUnresolved(result, fresh);
  reindex(result);
  return result;
}

/** Preserve known ownership while recording that its latest local read failed. */
function markUnresolved(result: AuditSnapshot, fresh: AuditSnapshot): void {
  const unresolved = new Set(fresh.issues.filter((issue) => issue.unchecked).map((issue) => normalizePathForIdentity(issue.location)));
  for (const note of result.notes) {
    if (unresolved.has(normalizePathForIdentity(note.notePath))) {
      note.status = 'unchecked-frontmatter';
    }
  }
  for (const marker of result.markers) {
    if (unresolved.has(normalizePathForIdentity(marker.markerPath))) {
      marker.status = 'unchecked-marker';
    }
  }
}

function reindex(result: AuditSnapshot): void {
  result.vault = { bindings: new Map(), duplicatePaths: new Map(), invalidFrontmatter: [] };
  result.external = {
    ...result.external,
    accessErrors: [],
    bindings: new Map(),
    directories: result.folders,
    duplicatePaths: new Map(),
    legacyMarkers: [],
    malformedMarkers: [],
    markers: [],
    skippedDirectories: []
  };
  for (const note of result.notes) {
    if (note.uuid) {
      registerUuidBinding(result.vault.bindings, result.vault.duplicatePaths, note.uuid, note.relativePath);
    }
  }
  for (const marker of result.markers) {
    if (marker.uuid) {
      registerUuidBinding(result.external.bindings, result.external.duplicatePaths, marker.uuid, marker.folderPath, { ignoreExactDuplicate: true });
      if (marker.status !== 'valid') {
        continue;
      }
      const record = { ...marker, format: marker.format === 'legacy' ? 'legacy' as const : 'uuid-named' as const };
      result.external.markers?.push(record);
      if (record.format === 'legacy') {
        result.external.legacyMarkers?.push(record);
      }
    }
  }
  for (const issue of result.issues) {
    const record = { location: issue.location, message: issue.reason };
    if (issue.scope === 'vault') {
      result.vault.invalidFrontmatter.push(record);
    } else if (issue.kind === 'marker') {
      result.external.malformedMarkers.push(record);
    } else if (issue.unchecked) {
      result.external.skippedDirectories.push(record);
    }
  }
}
