import { constants } from 'node:fs';
import {
  access,
  stat
} from 'node:fs/promises';
import path from 'node:path';

import { openExternalFolderInFileManager } from './boundExternalFolder.ts';

export function assertAuditRoots(vaultRoot: string | undefined, externalRoot: string): asserts vaultRoot is string {
  if (!vaultRoot || !path.isAbsolute(vaultRoot) || !path.isAbsolute(externalRoot)) {
    throw new Error('This report requires an absolute filesystem vault path and external root.');
  }
}
export async function openExistingAuditFolder(folderPath: string): Promise<void> {
  if (!(await stat(folderPath)).isDirectory()) {
    throw new Error('Folder is no longer available.');
  }
  await openExternalFolderInFileManager(folderPath);
}
export async function validateAuditDestination(value: string): Promise<string> {
  const destination = value.trim();
  if (!path.isAbsolute(destination) || !(await stat(destination)).isDirectory()) {
    throw new Error('Invalid directory');
  }
  await access(destination, constants.W_OK);
  return destination;
}
