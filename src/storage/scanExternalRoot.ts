import type { Dirent } from 'node:fs';

import {
  readdir,
  readFile,
  realpath
} from 'node:fs/promises';
import path from 'node:path';

import type { ExternalScanResult } from '../core/verify.ts';

import { EXNF_MARKER_FILE_NAME } from '../core/contracts.ts';
import { buildExternalRootIgnoreMatcher } from '../core/externalRootIgnore.ts';
import { parseExnfMarker } from '../core/marker.ts';

export interface ScanExternalRootFileSystem {
  readDirectoryEntries: (directoryPath: string) => Promise<Dirent[]>;
  readMarkerFile: (markerPath: string) => Promise<string>;
  resolveRealPath: (inputPath: string) => Promise<string>;
}

export interface ScanExternalRootOptions {
  fileSystem?: ScanExternalRootFileSystem;
  ignorePatterns?: readonly string[];
}

const DEFAULT_FILE_SYSTEM: ScanExternalRootFileSystem = {
  readDirectoryEntries: async (directoryPath) =>
    readdir(directoryPath, {
      encoding: 'utf8',
      withFileTypes: true
    }),
  readMarkerFile: async (markerPath) => readFile(markerPath, 'utf8'),
  resolveRealPath: realpath
};

export async function scanExternalRoot(
  externalRootPath: string,
  options: ScanExternalRootOptions = {}
): Promise<ExternalScanResult> {
  const fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;
  const trimmedRootPath = externalRootPath.trim();
  const result: ExternalScanResult = {
    accessErrors: [],
    bindings: new Map<string, string>(),
    directories: [],
    duplicatePaths: new Map<string, string[]>(),
    ignoredDirectories: [],
    ignoreErrors: [],
    ignorePatterns: [],
    malformedMarkers: [],
    rootPath: trimmedRootPath,
    skippedDirectories: []
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
    canonicalRootPath = await fileSystem.resolveRealPath(trimmedRootPath);
  } catch (error: unknown) {
    result.accessErrors.push({
      location: trimmedRootPath,
      message: getErrorMessage(error)
    });
    return result;
  }

  result.rootPath = canonicalRootPath;
  const ignoreMatcher = buildExternalRootIgnoreMatcher(canonicalRootPath, options.ignorePatterns ?? []);
  result.ignoreErrors = ignoreMatcher.errors;
  result.ignorePatterns = ignoreMatcher.patterns;
  await walkDirectory(canonicalRootPath, result, fileSystem, ignoreMatcher, true);
  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown filesystem error.';
}

function ignoreMatcherRelativePath(externalRootPath: string, folderPath: string): string {
  return path.relative(externalRootPath, folderPath).replaceAll(path.sep, '/');
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
  result: ExternalScanResult,
  fileSystem: ScanExternalRootFileSystem,
  ignoreMatcher: ReturnType<typeof buildExternalRootIgnoreMatcher>,
  isRoot: boolean
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fileSystem.readDirectoryEntries(directoryPath);
  } catch (error: unknown) {
    const issue = {
      location: directoryPath,
      message: getErrorMessage(error)
    };
    if (isRoot) {
      result.accessErrors.push(issue);
    } else {
      result.skippedDirectories.push(issue);
    }
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (ignoreMatcher.ignoresAbsoluteDirectoryPath(entryPath)) {
        result.ignoredDirectories.push({
          folderPath: entryPath,
          relativePath: ignoreMatcherRelativePath(result.rootPath, entryPath)
        });
        continue;
      }

      result.directories.push(entryPath);
      await walkDirectory(entryPath, result, fileSystem, ignoreMatcher, false);
      continue;
    }

    if (!entry.isFile() || entry.name !== EXNF_MARKER_FILE_NAME) {
      continue;
    }

    try {
      const markerContent = await fileSystem.readMarkerFile(entryPath);
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
