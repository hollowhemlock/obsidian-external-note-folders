import {
  execFile,
  spawn
} from 'node:child_process';
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { EXNF_MARKER_FILE_NAME } from '../core/contracts.ts';
import {
  parseExnfMarker,
  serializeExnfMarker
} from '../core/marker.ts';
import { deriveExternalFolderPath } from '../core/pathPolicy.ts';

export interface EnsureExpectedBoundExternalFolderInput {
  createIfMissing: boolean;
  externalRootPath: string;
  notePath: string;
  uuid: string;
}

export type EnsureExpectedBoundExternalFolderResult =
  | { created: boolean; folderPath: string; kind: 'bound' }
  | { folderPath: string; kind: 'missing' };

export interface ExpectedExternalFolderInput {
  externalRootPath: string;
  notePath: string;
  uuid: string;
}

export type ExpectedExternalFolderInspection =
  | { folderPath: string; kind: 'bound' }
  | { folderPath: string; kind: 'malformed-marker'; markerPath: string; message: string }
  | { folderPath: string; kind: 'mismatched-marker'; markerUuid: string }
  | { folderPath: string; kind: 'missing' }
  | { folderPath: string; kind: 'unmarked' };

export interface WriteExpectedMarkerIfUnmarkedResult {
  folderPath: string;
  markerWritten: boolean;
}

export async function ensureExpectedBoundExternalFolder(
  input: EnsureExpectedBoundExternalFolderInput
): Promise<EnsureExpectedBoundExternalFolderResult> {
  const inspection = await inspectExpectedExternalFolder(input);
  if (inspection.kind === 'missing') {
    if (!input.createIfMissing) {
      return {
        folderPath: inspection.folderPath,
        kind: 'missing'
      };
    }

    const canonicalRootPath = await resolveExternalRootPath(input.externalRootPath);
    await assertSafeCreationPath(canonicalRootPath, inspection.folderPath);
    await mkdir(inspection.folderPath, { recursive: true });
    await writeMarker(inspection.folderPath, input.uuid);
    return {
      created: true,
      folderPath: inspection.folderPath,
      kind: 'bound'
    };
  }

  if (inspection.kind === 'bound') {
    return {
      created: false,
      folderPath: inspection.folderPath,
      kind: 'bound'
    };
  }

  throwExpectedInspectionError(inspection);
}

export async function inspectExpectedExternalFolder(
  input: ExpectedExternalFolderInput
): Promise<ExpectedExternalFolderInspection> {
  const canonicalRootPath = await resolveExternalRootPath(input.externalRootPath);
  const targetFolderPath = deriveExternalFolderPath(input.notePath, canonicalRootPath);
  const targetStat = await tryLstat(targetFolderPath);
  if (!targetStat) {
    return {
      folderPath: targetFolderPath,
      kind: 'missing'
    };
  }

  await assertExistingPathHasNoSymlinks(canonicalRootPath, targetFolderPath);

  if (targetStat.isSymbolicLink()) {
    throw new Error(`External folder path crosses a symbolic link or reparse point: ${targetFolderPath}`);
  }

  if (!targetStat.isDirectory()) {
    throw new Error(`Derived external folder path is already occupied: ${targetFolderPath}`);
  }

  const markerPath = path.join(targetFolderPath, EXNF_MARKER_FILE_NAME);
  let markerUuid: string;
  try {
    markerUuid = parseExnfMarker(await readFile(markerPath, 'utf8'));
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return {
        folderPath: targetFolderPath,
        kind: 'unmarked'
      };
    }

    return {
      folderPath: targetFolderPath,
      kind: 'malformed-marker',
      markerPath,
      message: toError(error).message
    };
  }

  if (markerUuid !== input.uuid) {
    return {
      folderPath: targetFolderPath,
      kind: 'mismatched-marker',
      markerUuid
    };
  }

  return {
    folderPath: targetFolderPath,
    kind: 'bound'
  };
}

export async function openExternalFolderInFileManager(folderPath: string): Promise<void> {
  await access(folderPath);

  const command = getOpenCommand();
  if (command.detached) {
    const childProcess = spawn(command.file, [...command.arguments, folderPath], {
      detached: true,
      stdio: 'ignore'
    });
    childProcess.unref();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    execFile(command.file, [...command.arguments, folderPath], (error) => {
      if (error) {
        reject(toError(error));
        return;
      }

      resolve();
    });
  });
}

export async function resolveExternalRootPath(externalRootPath: string): Promise<string> {
  const trimmedRootPath = externalRootPath.trim();
  if (!trimmedRootPath) {
    throw new Error('External root is not configured.');
  }

  if (!path.isAbsolute(trimmedRootPath)) {
    throw new Error('External root must be an absolute path.');
  }

  return await realpath(trimmedRootPath);
}

export async function writeExpectedMarkerIfUnmarked(
  input: ExpectedExternalFolderInput
): Promise<WriteExpectedMarkerIfUnmarkedResult> {
  const inspection = await inspectExpectedExternalFolder(input);
  if (inspection.kind !== 'unmarked') {
    if (inspection.kind === 'bound') {
      throw new Error(`Expected external folder is already marked: ${inspection.folderPath}`);
    }

    throwExpectedInspectionError(inspection);
  }

  await writeNewMarkerFile(path.join(inspection.folderPath, EXNF_MARKER_FILE_NAME), input.uuid);
  return {
    folderPath: inspection.folderPath,
    markerWritten: true
  };
}

async function assertExistingPathHasNoSymlinks(externalRootPath: string, targetFolderPath: string): Promise<void> {
  const relativePath = path.relative(externalRootPath, targetFolderPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath === '') {
    throw new Error(`Derived external folder path escapes the configured root: ${targetFolderPath}`);
  }

  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = externalRootPath;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const stat = await lstat(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`External folder path crosses a symbolic link or reparse point: ${currentPath}`);
    }
  }
}

async function assertSafeCreationPath(externalRootPath: string, targetFolderPath: string): Promise<void> {
  const relativePath = path.relative(externalRootPath, targetFolderPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath === '') {
    throw new Error(`Derived external folder path escapes the configured root: ${targetFolderPath}`);
  }

  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = externalRootPath;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    const stat = await tryLstat(currentPath);
    if (!stat) {
      return;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`External folder path crosses a symbolic link or reparse point: ${currentPath}`);
    }
  }

  throw new Error(`Derived external folder path is already occupied: ${targetFolderPath}`);
}

function getOpenCommand(): { arguments: string[]; detached: boolean; file: string } {
  if (process.platform === 'win32') {
    return {
      arguments: [],
      detached: true,
      file: 'explorer.exe'
    };
  }

  if (process.platform === 'darwin') {
    return {
      arguments: [],
      detached: false,
      file: 'open'
    };
  }

  return {
    arguments: [],
    detached: false,
    file: 'xdg-open'
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}

function isPathAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EEXIST'
  );
}

function throwExpectedInspectionError(inspection: Exclude<ExpectedExternalFolderInspection, { kind: 'bound' }>): never {
  if (inspection.kind === 'missing') {
    throw new Error(`Expected external folder is missing: ${inspection.folderPath}`);
  }

  if (inspection.kind === 'unmarked') {
    throw new Error(`Derived external folder path is already occupied: ${inspection.folderPath}`);
  }

  if (inspection.kind === 'malformed-marker') {
    throw new Error(`Derived external folder marker is malformed at ${inspection.markerPath}: ${inspection.message}`);
  }

  throw new Error(`Derived external folder path is already bound to UUID ${inspection.markerUuid}: ${inspection.folderPath}`);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('Unable to open external folder.');
}

async function tryLstat(targetPath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(targetPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function writeMarker(boundFolderPath: string, uuid: string): Promise<void> {
  const markerPath = path.join(boundFolderPath, EXNF_MARKER_FILE_NAME);
  try {
    const existingContent = await readFile(markerPath, 'utf8');
    const existingUuid = parseExnfMarker(existingContent);
    if (existingUuid === uuid) {
      return;
    }

    throw new Error(`Existing marker UUID ${existingUuid} does not match ${uuid}.`);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      await writeNewMarkerFile(markerPath, uuid);
      return;
    }

    throw error;
  }
}

async function writeNewMarkerFile(markerPath: string, uuid: string): Promise<void> {
  try {
    await writeFile(markerPath, serializeExnfMarker(uuid), {
      encoding: 'utf8',
      flag: 'wx'
    });
  } catch (error: unknown) {
    if (isPathAlreadyExistsError(error)) {
      const existingUuid = parseExnfMarker(await readFile(markerPath, 'utf8'));
      if (existingUuid === uuid) {
        return;
      }
    }

    throw error;
  }
}
