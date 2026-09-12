import type { Dirent } from 'node:fs';

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath
} from 'node:fs/promises';
import path from 'node:path';

import type { SetupTargetInspection } from '../core/setupPlan.ts';

import { buildExternalRootIgnoreMatcher } from '../core/externalRootIgnore.ts';
import {
  classifyExnfMarkerFileName,
  parseLegacyExnfMarkerFile,
  parseUuidNamedExnfMarkerFile
} from '../core/marker.ts';
import {
  assertPathIsWithinRoot,
  deriveExternalFolderPath
} from '../core/pathPolicy.ts';
import { resolveExternalRootPath } from './boundExternalFolder.ts';

export async function assertSetupMarkerWriteReady(input: {
  allowPayload: boolean;
  targetPath: string;
  uuid: string;
}): Promise<void> {
  const targetStat = await lstat(input.targetPath);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error(`Setup target is not a safe directory: ${input.targetPath}`);
  }
  const entries = await readdir(input.targetPath, { encoding: 'utf8', withFileTypes: true });
  const errors: string[] = [];
  const markers = await readDirectoryMarkersFromEntries(input.targetPath, entries, errors);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
  const markerUuids = [...new Set(markers.map((marker) => marker.uuid))];
  if (markerUuids.length > 0 && (markerUuids.length !== 1 || markerUuids[0] !== input.uuid)) {
    throw new Error(`Setup target contains conflicting marker UUID(s): ${markerUuids.join(', ')}`);
  }
  if (!input.allowPayload && markerUuids.length === 0 && entries.length > 0) {
    throw new Error(`Setup target gained content before marker creation: ${input.targetPath}`);
  }
}

export async function createSetupTargetExclusively(
  externalRootPath: string,
  targetPath: string,
  allowExistingEmpty = false
): Promise<void> {
  const canonicalRootPath = await resolveExternalRootPath(externalRootPath);
  assertPathIsWithinRoot(canonicalRootPath, targetPath);
  await assertExistingAncestorsAreDirectories(canonicalRootPath, path.dirname(targetPath));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await assertExistingAncestorsAreDirectories(canonicalRootPath, path.dirname(targetPath));
  assertPathDoesNotEscapeRoot(canonicalRootPath, await realpath(path.dirname(targetPath)));
  try {
    await mkdir(targetPath);
  } catch (error: unknown) {
    if (!isAlreadyExistsError(error) || !allowExistingEmpty) {
      throw error;
    }
    const targetStat = await lstat(targetPath);
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw new Error(`Setup target appeared as an unsafe path: ${targetPath}`, { cause: error });
    }
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      throw new Error(`Setup target appeared with content before creation: ${targetPath}`, { cause: error });
    }
  }
}

export async function inspectSetupTarget(input: {
  externalRootPath: string;
  ignorePatterns: readonly string[];
  notePath: string;
}): Promise<SetupTargetInspection> {
  const externalRootPath = await resolveExternalRootPath(input.externalRootPath);
  const targetPath = deriveExternalFolderPath(input.notePath, externalRootPath);
  assertPathIsWithinRoot(externalRootPath, targetPath);
  const ignoreMatcher = buildExternalRootIgnoreMatcher(externalRootPath, input.ignorePatterns);
  const inspection: SetupTargetInspection = {
    ancestorMarkerPaths: [],
    descendantMarkerPaths: [],
    directoryPaths: [],
    errors: ignoreMatcher.errors.map((error) => `Invalid ignore pattern ${error.pattern}: ${error.message}`),
    externalRootPath,
    ignoredDirectories: [],
    legacyMarkerPaths: [],
    skippedDirectories: [],
    targetIgnored: ignoreMatcher.ignoresAbsoluteDirectoryPath(targetPath),
    targetKind: 'missing',
    targetMarkerUuids: [],
    targetPath
  };

  await inspectAncestors(externalRootPath, targetPath, inspection);
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(targetPath);
  } catch (error: unknown) {
    if (isMissingError(error)) {
      return inspection;
    }
    inspection.errors.push(toErrorMessage(error));
    return inspection;
  }

  if (targetStat.isSymbolicLink()) {
    inspection.errors.push(`Expected external folder crosses a symbolic link or reparse point: ${targetPath}`);
    return inspection;
  }
  if (!targetStat.isDirectory()) {
    inspection.errors.push(`Expected external folder path is occupied by a file: ${targetPath}`);
    return inspection;
  }

  inspection.targetKind = 'directory';
  await walkTarget(targetPath, targetPath, inspection, ignoreMatcher);
  inspection.ancestorMarkerPaths.sort();
  inspection.descendantMarkerPaths.sort();
  inspection.directoryPaths.sort();
  inspection.ignoredDirectories.sort();
  inspection.legacyMarkerPaths.sort();
  inspection.skippedDirectories.sort();
  inspection.targetMarkerUuids = [...new Set(inspection.targetMarkerUuids)].sort();
  inspection.errors.sort();
  return inspection;
}

async function assertExistingAncestorsAreDirectories(externalRootPath: string, parentPath: string): Promise<void> {
  const segments = path.relative(externalRootPath, parentPath).split(path.sep).filter(Boolean);
  let currentPath = externalRootPath;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const stat = await lstat(currentPath);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Expected external folder ancestor is unsafe: ${currentPath}`);
      }
    } catch (error: unknown) {
      if (isMissingError(error)) {
        return;
      }
      throw error;
    }
  }
}

function assertPathDoesNotEscapeRoot(externalRootPath: string, candidatePath: string): void {
  const relativePath = path.relative(externalRootPath, candidatePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Expected external folder parent escapes the configured root: ${candidatePath}`);
  }
}

async function inspectAncestors(
  externalRootPath: string,
  targetPath: string,
  inspection: SetupTargetInspection
): Promise<void> {
  const relativeSegments = path.relative(externalRootPath, path.dirname(targetPath)).split(path.sep).filter(Boolean);
  let currentPath = externalRootPath;
  for (const segment of ['', ...relativeSegments]) {
    if (segment) {
      currentPath = path.join(currentPath, segment);
    }
    try {
      const stat = await lstat(currentPath);
      if (stat.isSymbolicLink()) {
        inspection.errors.push(`Expected external folder ancestor crosses a symbolic link or reparse point: ${currentPath}`);
        return;
      }
      if (!stat.isDirectory()) {
        inspection.errors.push(`Expected external folder ancestor is not a directory: ${currentPath}`);
        return;
      }
      const markers = await readDirectoryMarkers(currentPath, inspection.errors);
      inspection.ancestorMarkerPaths.push(...markers.map((marker) => marker.markerPath));
    } catch (error: unknown) {
      if (isMissingError(error)) {
        return;
      }
      inspection.errors.push(`Unable to inspect expected folder ancestor ${currentPath}: ${toErrorMessage(error)}`);
      return;
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function isMissingError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function readDirectoryMarkers(
  directoryPath: string,
  errors: string[]
): Promise<{ format: 'legacy' | 'uuid-named'; markerPath: string; uuid: string }[]> {
  const entries = await readdir(directoryPath, { encoding: 'utf8', withFileTypes: true });
  return readDirectoryMarkersFromEntries(directoryPath, entries, errors);
}

async function readDirectoryMarkersFromEntries(
  directoryPath: string,
  entries: Dirent[],
  errors: string[]
): Promise<{ format: 'legacy' | 'uuid-named'; markerPath: string; uuid: string }[]> {
  const markers: { format: 'legacy' | 'uuid-named'; markerPath: string; uuid: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const markerPath = path.join(directoryPath, entry.name);
    try {
      const fileName = classifyExnfMarkerFileName(entry.name);
      if (fileName.kind === 'not-marker') {
        continue;
      }
      const marker = fileName.kind === 'uuid-named'
        ? parseUuidNamedExnfMarkerFile(entry.name)
        : parseLegacyExnfMarkerFile(entry.name, await readFile(markerPath, 'utf8'));
      markers.push({ format: marker.format, markerPath, uuid: marker.uuid });
    } catch (error: unknown) {
      errors.push(`Malformed marker at ${markerPath}: ${toErrorMessage(error)}`);
    }
  }
  return markers;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown filesystem error.';
}

async function walkTarget(
  directoryPath: string,
  targetPath: string,
  inspection: SetupTargetInspection,
  ignoreMatcher: ReturnType<typeof buildExternalRootIgnoreMatcher>
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directoryPath, { encoding: 'utf8', withFileTypes: true });
  } catch {
    inspection.skippedDirectories.push(directoryPath);
    return;
  }

  const markers = await readDirectoryMarkersFromEntries(directoryPath, entries, inspection.errors);
  if (directoryPath === targetPath) {
    inspection.targetMarkerUuids.push(...markers.map((marker) => marker.uuid));
    inspection.legacyMarkerPaths.push(
      ...markers
        .filter((marker) => marker.format === 'legacy')
        .map((marker) => marker.markerPath)
    );
  } else if (markers.length > 0) {
    inspection.descendantMarkerPaths.push(...markers.map((marker) => marker.markerPath));
  }

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const childPath = path.join(directoryPath, entry.name);
    if (ignoreMatcher.ignoresAbsoluteDirectoryPath(childPath)) {
      inspection.ignoredDirectories.push(childPath);
      continue;
    }
    try {
      const childStat = await lstat(childPath);
      if (entry.isSymbolicLink() || childStat.isSymbolicLink()) {
        inspection.errors.push(`Expected external folder contains a symbolic link or reparse point: ${childPath}`);
        continue;
      }
    } catch (error: unknown) {
      inspection.errors.push(`Unable to inspect expected folder descendant ${childPath}: ${toErrorMessage(error)}`);
      continue;
    }
    inspection.directoryPaths.push(childPath);
    await walkTarget(childPath, targetPath, inspection, ignoreMatcher);
  }
}
