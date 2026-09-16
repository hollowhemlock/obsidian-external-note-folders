// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation follows ADR-0016.
import path from 'node:path';

import type { AuditSnapshot } from './auditTypes.ts';

import { buildExternalRootIgnoreMatcher } from './externalRootIgnore.ts';
import {
  assertPathIsWithinRoot,
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export interface AdoptionNoteChoice {
  aliases: unknown;
  path: string;
}
export interface GroupAdoptionPlan {
  aliases: null | string[];
  descendants: string[];
  expectedFolder: string;
  externalRoot: string;
  folderPath: string;
  ignorePatterns: string[];
  mutationSequence: number;
  notePath: string;
  sourcePath: null | string;
  uuid: string;
  vaultRoot: string;
  warnings: string[];
}
export function aliasesWithPreviousName(value: unknown, basename: string): string[] {
  let aliases = value;
  if (value === undefined) {
    aliases = [];
  }
  if (typeof value === 'string') {
    aliases = [value];
  }
  if (!Array.isArray(aliases) || !aliases.every((alias): alias is string => typeof alias === 'string')) {
    throw new Error('Cannot preserve malformed aliases. Correct aliases before moving this note.');
  }
  return aliases.some((alias) => alias.toLowerCase() === basename.toLowerCase()) ? [...aliases] : [...aliases, basename];
}
export function buildGroupAdoptionPlan(input: {
  folderPath: string;
  ignorePatterns: string[];
  move: boolean;
  mutationSequence: number;
  note: AdoptionNoteChoice | null;
  snapshot: AuditSnapshot;
  uuid: string;
}): GroupAdoptionPlan {
  const { folderPath, note, snapshot: scan } = input;
  assertPathIsWithinRoot(scan.externalRoot, folderPath);
  if (!scan.folders.some((folder) => normalizePathForIdentity(folder) === normalizePathForIdentity(folderPath))) {
    throw new Error('Selected folder was not inspected.');
  }
  const matcher = buildExternalRootIgnoreMatcher(scan.externalRoot, input.ignorePatterns);
  if (matcher.errors.length || matcher.ignoresAbsoluteDirectoryPath(folderPath)) {
    throw new Error('Ignored target or invalid ignore settings. Change plugin settings before adoption.');
  }
  const notePath = !note || input.move ? matchingNotePath(scan.externalRoot, folderPath) : note.path;
  const expectedFolder = deriveExternalFolderPath(notePath, scan.externalRoot);
  if ((!note || input.move) && normalizePathForIdentity(expectedFolder) !== normalizePathForIdentity(folderPath)) {
    throw new Error('Proposed note does not map back to this folder. Select an existing note and bind without moving.');
  }
  if (matcher.ignoresAbsoluteDirectoryPath(expectedFolder)) {
    throw new Error('The note-derived target is ignored. Change settings first.');
  }
  const { reusing, uuid } = resolveNoteIdentity(scan, note, input.uuid);
  const targets = [folderPath, expectedFolder];
  validateEvidence(scan, targets, uuid, reusing);
  const descendants = validateReservedTargets(scan, targets, note?.path, expectedFolder, folderPath);
  const warnings: string[] = [];
  if (normalizePathForIdentity(expectedFolder) !== normalizePathForIdentity(folderPath)) {
    warnings.push(`Neither item moves. Reconcile would target ${expectedFolder}.`);
    if (scan.folders.some((folder) => normalizePathForIdentity(folder) === normalizePathForIdentity(expectedFolder))) {
      warnings.push('Reconcile destination already exists; reconciliation cannot currently move this folder there.');
    }
  }
  const previousName = note ? path.posix.basename(note.path, '.md') : '';
  const renamed = note && previousName !== path.posix.basename(notePath, '.md');
  return {
    aliases: renamed ? aliasesWithPreviousName(note.aliases, previousName) : null,
    descendants: descendants.sort(),
    expectedFolder,
    externalRoot: scan.externalRoot,
    folderPath,
    ignorePatterns: [...input.ignorePatterns],
    mutationSequence: input.mutationSequence,
    notePath,
    sourcePath: note?.path ?? null,
    uuid,
    vaultRoot: scan.vaultRoot,
    warnings
  };
}
export function matchingNotePath(root: string, folder: string): string {
  assertPathIsWithinRoot(root, folder);
  return `${path.relative(root, folder).split(path.sep).join('/')}.md`;
}
export function noteMatchReason(note: AdoptionNoteChoice, folder: string, root: string, search = ''): null | string {
  const name = path.basename(folder).toLowerCase();
  let aliases: string[] = [];
  if (typeof note.aliases === 'string') {
    aliases = [note.aliases];
  } else if (Array.isArray(note.aliases)) {
    aliases = note.aliases.filter((v): v is string => typeof v === 'string');
  }
  if (search && ![note.path, ...aliases].some((value) => value.toLowerCase().includes(search.toLowerCase()))) {
    return null;
  }
  try {
    if (normalizePathForIdentity(deriveExternalFolderPath(note.path, root)) === normalizePathForIdentity(folder)) {
      return 'Exact path';
    }
  } catch { /* Invalid paths can still be inspected through search. */ }
  if (path.posix.basename(note.path, '.md').toLowerCase() === name) {
    return 'Same filename';
  }
  const alias = aliases.find((value) => value.toLowerCase() === name);
  if (alias) {
    return `Alias: ${alias}`;
  }
  return search ? 'Search result' : null;
}
export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePathForIdentity(a);
  const right = normalizePathForIdentity(b);
  return left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep);
}
function resolveNoteIdentity(scan: AuditSnapshot, note: AdoptionNoteChoice | null, proposed: string): { reusing: boolean; uuid: string } {
  const selected = note ? scan.notes.find((entry) => entry.relativePath === note.path) : undefined;
  if (note && (!selected || !['missing-property', 'valid'].includes(selected.status))) {
    throw new Error('Selected note has invalid or unchecked frontmatter.');
  }
  let uuid = proposed;
  if (selected && selected.uuid.length > 0) {
    uuid = selected.uuid;
  }
  if (scan.notes.some((entry) => entry.relativePath !== note?.path && entry.uuid === uuid)) {
    throw new Error('UUID is already used by another note.');
  }
  return { reusing: !!selected?.uuid, uuid };
}
function validateEvidence(scan: AuditSnapshot, targets: string[], uuid: string, reusing: boolean): void {
  for (const marker of scan.markers) {
    if (marker.uuid === uuid || targets.some((target) => pathsOverlap(marker.folderPath, target))) {
      throw new Error(`Conflicting marker: ${marker.markerPath}`);
    }
  }
  for (const issue of scan.issues.filter((entry) => entry.unchecked)) {
    if (reusing || pathsOverlap(issue.location, scan.vaultRoot) || targets.some((target) => pathsOverlap(issue.location, target))) {
      throw new Error(`Unchecked evidence: ${issue.location}`);
    }
  }
}
function validateReservedTargets(
  scan: AuditSnapshot,
  targets: string[],
  selectedPath: string | undefined,
  expectedFolder: string,
  folderPath: string
): string[] {
  const descendants: string[] = [];
  for (const entry of scan.notes) {
    if (entry.relativePath === selectedPath) {
      continue;
    }
    let target: string;
    try {
      target = deriveExternalFolderPath(entry.relativePath, scan.externalRoot);
    } catch {
      continue;
    }
    if (targets.some((candidate) => pathsOverlap(target, candidate))) {
      if (entry.hasExnf) {
        throw new Error(`Identified or invalid note reserves this branch: ${entry.relativePath}`);
      }
      if (normalizePathForIdentity(target) === normalizePathForIdentity(expectedFolder)) {
        throw new Error(`Another note derives the same target: ${entry.relativePath}`);
      }
      if (normalizePathForIdentity(target).startsWith(normalizePathForIdentity(folderPath) + path.sep)) {
        descendants.push(entry.relativePath);
      }
    }
  }
  return descendants;
}
