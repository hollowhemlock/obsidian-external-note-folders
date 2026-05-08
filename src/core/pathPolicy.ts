import { createHash } from 'node:crypto';
import path from 'node:path';

const INVALID_WINDOWS_PATH_CHARACTERS_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/gu;
const RESERVED_WINDOWS_NAMES = new Set([
  'AUX',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'CON',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'NUL',
  'PRN'
]);

const DEFAULT_MAX_TARGET_PATH_LENGTH = 240;
const FOLDER_NOTE_SEGMENT_COUNT = 2;
const MIN_SHORTENED_COMPONENT_LENGTH = 12;
const PARENT_FOLDER_SEGMENT_OFFSET = 2;
const SHORT_HASH_LENGTH = 8;

export function assertPathIsWithinRoot(externalRootPath: string, candidatePath: string): void {
  const relativePath = path.relative(externalRootPath, candidatePath);
  if (
    relativePath.startsWith('..')
    || path.isAbsolute(relativePath)
    || relativePath === ''
  ) {
    throw new Error(`Derived external folder path escapes the configured root: ${candidatePath}`);
  }
}

export function deriveExternalFolderPath(
  notePath: string,
  externalRootPath: string,
  maxTargetPathLength = DEFAULT_MAX_TARGET_PATH_LENGTH
): string {
  const relativeSegments = deriveExternalFolderRelativeSegments(notePath);
  const shortenedSegments = shortenSegmentsToFit(externalRootPath, relativeSegments, maxTargetPathLength);
  const candidatePath = path.resolve(externalRootPath, ...shortenedSegments);
  assertPathIsWithinRoot(externalRootPath, candidatePath);
  return candidatePath;
}

export function deriveExternalFolderRelativeSegments(notePath: string): string[] {
  const normalizedNotePath = notePath.normalize('NFC');
  if (!normalizedNotePath.endsWith('.md')) {
    throw new Error(`Expected a markdown note path, received '${notePath}'.`);
  }

  const noteStemPath = normalizedNotePath.slice(0, -'.md'.length);
  return collapseFolderNoteSegments(noteStemPath.split('/'))
    .map((segment) => sanitizePathComponent(segment));
}

export function normalizePathForIdentity(candidatePath: string): string {
  const normalizedPath = path.normalize(candidatePath.normalize('NFC'));
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return normalizedPath.toLowerCase();
  }

  return normalizedPath;
}

export function sanitizePathComponent(component: string): string {
  const normalizedComponent = component.normalize('NFC');
  const replacedInvalidCharacters = normalizedComponent.replaceAll(
    INVALID_WINDOWS_PATH_CHARACTERS_PATTERN,
    '_'
  );
  const trimmedTrailingDotsAndSpaces = replacedInvalidCharacters.replace(/[ .]+$/u, '');

  let sanitizedComponent = trimmedTrailingDotsAndSpaces;
  if (
    sanitizedComponent.length === 0
    || sanitizedComponent === '.'
    || sanitizedComponent === '..'
  ) {
    sanitizedComponent = '_';
  }

  if (RESERVED_WINDOWS_NAMES.has(sanitizedComponent.toUpperCase())) {
    sanitizedComponent = `${sanitizedComponent}_`;
  }

  return sanitizedComponent;
}

function collapseFolderNoteSegments(segments: string[]): string[] {
  if (segments.length < FOLDER_NOTE_SEGMENT_COUNT) {
    return segments;
  }

  const noteStem = segments.at(-1);
  const parentFolderName = segments[segments.length - PARENT_FOLDER_SEGMENT_OFFSET];
  if (noteStem && parentFolderName && noteStem === parentFolderName) {
    return segments.slice(0, -1);
  }

  return segments;
}

function shortenComponentToLength(component: string, maxLength: number): string {
  if (component.length <= maxLength) {
    return component;
  }

  const hash = createHash('sha1').update(component).digest('hex').slice(0, SHORT_HASH_LENGTH);
  const prefixLength = Math.max(1, maxLength - SHORT_HASH_LENGTH - 1);
  return `${component.slice(0, prefixLength)}~${hash}`;
}

function shortenSegmentsToFit(
  externalRootPath: string,
  segments: readonly string[],
  maxTargetPathLength: number
): string[] {
  const shortenedSegments = [...segments];
  let candidatePath = path.resolve(externalRootPath, ...shortenedSegments);
  if (candidatePath.length <= maxTargetPathLength) {
    return shortenedSegments;
  }

  for (let index = shortenedSegments.length - 1; index >= 0; index -= 1) {
    const overflow = candidatePath.length - maxTargetPathLength;
    if (overflow <= 0) {
      break;
    }

    const currentSegment = shortenedSegments[index];
    if (currentSegment === undefined) {
      continue;
    }

    const minimumSegmentLength = Math.min(currentSegment.length, MIN_SHORTENED_COMPONENT_LENGTH);
    const nextLength = Math.max(minimumSegmentLength, currentSegment.length - overflow);
    shortenedSegments[index] = shortenComponentToLength(currentSegment, nextLength);
    candidatePath = path.resolve(externalRootPath, ...shortenedSegments);
  }

  if (candidatePath.length > maxTargetPathLength) {
    throw new Error(`Derived external folder path exceeds ${String(maxTargetPathLength)} characters.`);
  }

  return shortenedSegments;
}
