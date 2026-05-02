import { isCanonicalUuid } from './uuid.ts';

export class ExfMarkerParseError extends Error {}

export function parseExfMarker(content: string): string {
  if (content.startsWith('\uFEFF')) {
    throw new ExfMarkerParseError('Marker must not include a UTF-8 BOM.');
  }

  if (content.includes('\r')) {
    throw new ExfMarkerParseError('Marker must use LF line endings only.');
  }

  let parsedContent = content;
  if (parsedContent.endsWith('\n')) {
    parsedContent = parsedContent.slice(0, -1);
  }

  if (parsedContent.includes('\n')) {
    throw new ExfMarkerParseError('Marker must contain exactly one UUID line.');
  }

  if (!isCanonicalUuid(parsedContent)) {
    throw new ExfMarkerParseError('Marker must contain a canonical lowercase UUID.');
  }

  return parsedContent;
}

export function serializeExfMarker(uuid: string): string {
  if (!isCanonicalUuid(uuid)) {
    throw new Error('Expected a canonical lowercase UUID.');
  }

  return `${uuid}\n`;
}
