import type { Dirent } from 'node:fs';

import {
  readdir,
  readFile,
  realpath
} from 'node:fs/promises';
import path from 'node:path';

import type { ExternalScanResult } from '../core/verify.ts';

import { EXNF_MARKER_FILE_NAME } from '../core/contracts.ts';
import { parseExnfMarker } from '../core/marker.ts';

export async function scanExternalRoot(externalRootPath: string): Promise<ExternalScanResult> {
  const trimmedRootPath = externalRootPath.trim();
  const result: ExternalScanResult = {
    accessErrors: [],
    bindings: new Map<string, string>(),
    directories: [],
    duplicatePaths: new Map<string, string[]>(),
    malformedMarkers: [],
    rootPath: trimmedRootPath
  };

  if (!trimmedRootPath) {
    result.accessErrors.push({
      location: '(settings)',
      message: 'External root is not configured.'
    });
    return result;
  }

  if (!path.isAbsolute(trimmedRootPath)) {
    result.accessErrors.push({
      location: trimmedRootPath,
      message: 'External root must be an absolute path.'
    });
    return result;
  }

  let canonicalRootPath: string;
  try {
    canonicalRootPath = await realpath(trimmedRootPath);
  } catch (error: unknown) {
    result.accessErrors.push({
      location: trimmedRootPath,
      message: getErrorMessage(error)
    });
    return result;
  }

  result.rootPath = canonicalRootPath;
  await walkDirectory(canonicalRootPath, result);
  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown filesystem error.';
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  return readdir(directoryPath, {
    encoding: 'utf8',
    withFileTypes: true
  });
}

function registerBinding(
  bindings: Map<string, string>,
  duplicatePaths: Map<string, string[]>,
  uuid: string,
  folderPath: string
): void {
  const existingPath = bindings.get(uuid);
  if (!existingPath) {
    bindings.set(uuid, folderPath);
    return;
  }

  const duplicateSet = new Set<string>(duplicatePaths.get(uuid) ?? [existingPath]);
  duplicateSet.add(folderPath);
  duplicatePaths.set(uuid, [...duplicateSet].sort());
}

async function walkDirectory(
  directoryPath: string,
  result: ExternalScanResult
): Promise<void> {
  let entries: Awaited<ReturnType<typeof readDirectoryEntries>>;
  try {
    entries = await readDirectoryEntries(directoryPath);
  } catch (error: unknown) {
    result.accessErrors.push({
      location: directoryPath,
      message: getErrorMessage(error)
    });
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      result.directories.push(entryPath);
      await walkDirectory(entryPath, result);
      continue;
    }

    if (!entry.isFile() || entry.name !== EXNF_MARKER_FILE_NAME) {
      continue;
    }

    try {
      const markerContent = await readFile(entryPath, 'utf8');
      const uuid = parseExnfMarker(markerContent);
      registerBinding(result.bindings, result.duplicatePaths, uuid, path.dirname(entryPath));
    } catch (error: unknown) {
      result.malformedMarkers.push({
        location: entryPath,
        message: getErrorMessage(error)
      });
    }
  }
}
