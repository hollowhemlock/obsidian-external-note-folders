import { isCanonicalUuid } from './uuid.ts';

export class ExnfMarkerParseError extends Error {}

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

export function serializeExnfMarker(uuid: string): string {
  if (!isCanonicalUuid(uuid)) {
    throw new Error('Expected a canonical lowercase UUID.');
  }

  return `${uuid}\n`;
}
