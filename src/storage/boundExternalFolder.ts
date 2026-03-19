import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { execFile } from 'node:child_process';

import { EXF_MARKER_FILE_NAME } from '../core/contracts.ts';
import {
  parseExfMarker,
  serializeExfMarker
} from '../core/marker.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from '../core/pathPolicy.ts';

export interface EnsureBoundExternalFolderInput {
  existingBindings: Map<string, string>;
  externalRootPath: string;
  notePath: string;
  uuid: string;
}

export interface EnsureBoundExternalFolderResult {
  created: boolean;
  folderPath: string;
}

export async function ensureBoundExternalFolder(
  input: EnsureBoundExternalFolderInput
): Promise<EnsureBoundExternalFolderResult> {
  const existingBindingPath = input.existingBindings.get(input.uuid);
  if (existingBindingPath) {
    return {
      created: false,
      folderPath: existingBindingPath
    };
  }

  const canonicalRootPath = await realpath(input.externalRootPath);
  const targetFolderPath = deriveExternalFolderPath(input.notePath, canonicalRootPath);
  const normalizedTargetPath = normalizePathForIdentity(targetFolderPath);

  for (const [existingUuid, existingFolderPath] of input.existingBindings) {
    if (existingUuid === input.uuid) {
      continue;
    }

    if (normalizePathForIdentity(existingFolderPath) === normalizedTargetPath) {
      throw new Error(`Derived external folder path is already bound to UUID ${existingUuid}: ${targetFolderPath}`);
    }
  }

  await assertSafeCreationPath(canonicalRootPath, targetFolderPath);
  await mkdir(targetFolderPath, { recursive: true });
  await writeMarker(targetFolderPath, input.uuid);

  return {
    created: true,
    folderPath: targetFolderPath
  };
}

export async function openExternalFolderInFileManager(folderPath: string): Promise<void> {
  await access(folderPath);

  const command = getOpenCommand();
  await new Promise<void>((resolve, reject) => {
    execFile(command.file, [...command.arguments, folderPath], (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
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

function getOpenCommand(): { arguments: string[]; file: string } {
  if (process.platform === 'win32') {
    return {
      arguments: [],
      file: 'explorer.exe'
    };
  }

  if (process.platform === 'darwin') {
    return {
      arguments: [],
      file: 'open'
    };
  }

  return {
    arguments: [],
    file: 'xdg-open'
  };
}

async function tryLstat(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch {
    return null;
  }
}

async function writeMarker(boundFolderPath: string, uuid: string): Promise<void> {
  const markerPath = path.join(boundFolderPath, EXF_MARKER_FILE_NAME);
  try {
    const existingContent = await readFile(markerPath, 'utf8');
    const existingUuid = parseExfMarker(existingContent);
    if (existingUuid === uuid) {
      return;
    }

    throw new Error(`Existing marker UUID ${existingUuid} does not match ${uuid}.`);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      await writeFile(markerPath, serializeExfMarker(uuid), 'utf8');
      return;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  );
}
