import type { Dirent } from 'node:fs';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ParsedExnfMarkerFile } from '../core/marker.ts';

import {
  classifyExnfMarkerFileName,
  parseLegacyExnfMarkerFile,
  parseUuidNamedExnfMarkerFile
} from '../core/marker.ts';

// Callers decide which entries to skip and whether an error stops their scan.
export async function readMarkerEntry(directoryPath: string, entry: Dirent): Promise<null | ParsedExnfMarkerFile> {
  const markerPath = path.join(directoryPath, entry.name);
  const fileName = classifyExnfMarkerFileName(entry.name);
  if (fileName.kind === 'not-marker') {
    return null;
  }
  if (!entry.isFile()) {
    throw new Error('Marker path is not a regular file.');
  }
  const marker = fileName.kind === 'uuid-named'
    ? parseUuidNamedExnfMarkerFile(entry.name)
    : parseLegacyExnfMarkerFile(entry.name, await readFile(markerPath, 'utf8'));
  return { format: marker.format, markerPath, uuid: marker.uuid };
}
