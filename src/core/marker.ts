import {
  EXNF_LEGACY_MARKER_FILE_NAME,
  EXNF_MARKER_FILE_EXTENSION
} from './contracts.ts';
import { isCanonicalUuid } from './uuid.ts';

export type ExnfMarkerFileName =
  | { kind: 'legacy' }
  | { kind: 'not-marker' }
  | { kind: 'uuid-named'; uuid: string };

export interface ExnfMarkerParseResult {
  format: 'legacy' | 'uuid-named';
  uuid: string;
}

export class ExnfMarkerParseError extends Error {}

export function buildExnfMarkerFileName(uuid: string): string {
  if (!isCanonicalUuid(uuid)) {
    throw new Error('Expected a canonical lowercase UUID.');
  }

  return `${uuid}${EXNF_MARKER_FILE_EXTENSION}`;
}

export function classifyExnfMarkerFileName(fileName: string): ExnfMarkerFileName {
  if (fileName === EXNF_LEGACY_MARKER_FILE_NAME) {
    return { kind: 'legacy' };
  }

  if (!fileName.endsWith(EXNF_MARKER_FILE_EXTENSION)) {
    return { kind: 'not-marker' };
  }

  const candidateUuid = fileName.slice(0, -EXNF_MARKER_FILE_EXTENSION.length);
  if (!isCanonicalUuid(candidateUuid)) {
    throw new ExnfMarkerParseError('Marker filename must be <canonical lowercase UUID>.exnf.');
  }

  return {
    kind: 'uuid-named',
    uuid: candidateUuid
  };
}

export function parseExnfMarker(content: string): string {
  if (content.startsWith('\uFEFF')) {
    throw new ExnfMarkerParseError('Marker must not include a UTF-8 BOM.');
  }

  if (content.includes('\r')) {
    throw new ExnfMarkerParseError('Marker must use LF line endings only.');
  }

  let parsedContent = content;
  if (parsedContent.endsWith('\n')) {
    parsedContent = parsedContent.slice(0, -1);
  }

  if (parsedContent.includes('\n')) {
    throw new ExnfMarkerParseError('Marker must contain exactly one UUID line.');
  }

  if (!isCanonicalUuid(parsedContent)) {
    throw new ExnfMarkerParseError('Marker must contain a canonical lowercase UUID.');
  }

  return parsedContent;
}

export function parseExnfMarkerFile(fileName: string, content: string): ExnfMarkerParseResult {
  const fileNameResult = classifyExnfMarkerFileName(fileName);
  if (fileNameResult.kind === 'not-marker') {
    throw new ExnfMarkerParseError('Not an EXNF marker file.');
  }

  const payloadUuid = parseExnfMarker(content);
  if (fileNameResult.kind === 'uuid-named' && fileNameResult.uuid !== payloadUuid) {
    throw new ExnfMarkerParseError(`Marker filename UUID ${fileNameResult.uuid} does not match payload UUID ${payloadUuid}.`);
  }

  return {
    format: fileNameResult.kind,
    uuid: payloadUuid
  };
}

export function serializeExnfMarker(uuid: string): string {
  if (!isCanonicalUuid(uuid)) {
    throw new Error('Expected a canonical lowercase UUID.');
  }

  return `${uuid}\n`;
}
