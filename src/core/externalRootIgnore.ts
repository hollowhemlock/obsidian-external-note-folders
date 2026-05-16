import ignoreFactory from 'ignore';

import { normalizeDisplayPath } from './displayPath.ts';

export interface ExternalRootIgnoreError {
  message: string;
  pattern: string;
}

export interface ExternalRootIgnoreMatcher {
  errors: ExternalRootIgnoreError[];
  ignoresAbsoluteDirectoryPath: (absolutePath: string) => boolean;
  ignoresRelativeDirectoryPath: (relativePath: string) => boolean;
  patterns: string[];
}

export interface ExternalRootIgnoreOptions {
  ignoreCase?: boolean;
}

export interface IgnoredDirectory {
  folderPath: string;
  relativePath: string;
}

const MAX_REPORTED_IGNORED_DIRECTORIES = 20;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:\//u;

export function buildExternalRootIgnoreMatcher(
  externalRootPath: string,
  rawPatterns: readonly string[] = [],
  options: ExternalRootIgnoreOptions = {}
): ExternalRootIgnoreMatcher {
  const normalizedPatterns = normalizeExternalRootIgnorePatterns(rawPatterns);
  const ignoreCase = options.ignoreCase ?? (process.platform === 'darwin' || process.platform === 'win32');
  const ignoreMatcher = ignoreFactory({
    ignorecase: ignoreCase
  });

  try {
    ignoreMatcher.add(normalizedPatterns.patterns);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid ignore pattern.';
    normalizedPatterns.errors.push({
      message,
      pattern: '(settings)'
    });
  }

  return {
    errors: normalizedPatterns.errors,
    ignoresAbsoluteDirectoryPath: (absolutePath: string) =>
      ignoresRelativeDirectoryPath(
        ignoreMatcher,
        toExternalRootRelativeIgnorePath(externalRootPath, absolutePath)
      ),
    ignoresRelativeDirectoryPath: (relativePath: string) => ignoresRelativeDirectoryPath(ignoreMatcher, normalizeRelativeIgnorePath(relativePath)),
    patterns: normalizedPatterns.patterns
  };
}

export function formatIgnoredDirectoryWarnings(ignoredDirectories: readonly IgnoredDirectory[]): string[] {
  if (ignoredDirectories.length === 0) {
    return [];
  }

  const sortedRelativePaths = ignoredDirectories
    .map((directory) => directory.relativePath)
    .sort();
  const shownPaths = sortedRelativePaths.slice(0, MAX_REPORTED_IGNORED_DIRECTORIES);
  const remainingCount = ignoredDirectories.length - shownPaths.length;
  const suffix = remainingCount > 0 ? `; ${String(remainingCount)} more omitted` : '';
  return [
    `Ignored ${String(ignoredDirectories.length)} external director${ignoredDirectories.length === 1 ? 'y' : 'ies'}: ${shownPaths.join(', ')}${suffix}`
  ];
}

export function normalizeExternalRootIgnorePatterns(rawPatterns: readonly string[]): {
  errors: ExternalRootIgnoreError[];
  patterns: string[];
} {
  const errors: ExternalRootIgnoreError[] = [];
  const patterns: string[] = [];

  for (const rawPattern of rawPatterns) {
    const normalizedPattern = normalizeExternalRootIgnorePattern(rawPattern);
    if (normalizedPattern === null) {
      continue;
    }

    if (normalizedPattern.startsWith('!')) {
      errors.push({
        message: 'Negation patterns are not supported.',
        pattern: normalizedPattern
      });
      continue;
    }

    if (WINDOWS_DRIVE_PATTERN.test(normalizedPattern) || normalizedPattern.startsWith('//')) {
      errors.push({
        message: 'Ignore patterns must be relative to the configured external root.',
        pattern: normalizedPattern
      });
      continue;
    }

    patterns.push(normalizedPattern);
  }

  return {
    errors,
    patterns
  };
}

export function toExternalRootRelativeIgnorePath(externalRootPath: string, absolutePath: string): string {
  const normalizedRootPath = trimTrailingSlashes(normalizeDisplayPath(externalRootPath));
  const normalizedAbsolutePath = normalizeDisplayPath(absolutePath);
  if (!normalizedRootPath) {
    return normalizeRelativeIgnorePath(normalizedAbsolutePath);
  }

  const comparableRootPath = normalizePathForIgnoreComparison(normalizedRootPath);
  const comparableAbsolutePath = normalizePathForIgnoreComparison(normalizedAbsolutePath);
  if (comparableAbsolutePath === comparableRootPath) {
    return '';
  }

  const comparableRootPrefix = `${comparableRootPath}/`;
  if (comparableAbsolutePath.startsWith(comparableRootPrefix)) {
    return normalizeRelativeIgnorePath(normalizedAbsolutePath.slice(comparableRootPrefix.length));
  }

  return normalizeRelativeIgnorePath(normalizedAbsolutePath);
}

function ignoresRelativeDirectoryPath(ignoreMatcher: ReturnType<typeof ignoreFactory>, relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath === '.') {
    return false;
  }

  const directoryPath = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
  return ignoreMatcher.ignores(directoryPath);
}

function normalizeExternalRootIgnorePattern(rawPattern: string): null | string {
  const normalizedPattern = rawPattern.trim().replaceAll('\\', '/');
  if (normalizedPattern.length === 0 || normalizedPattern.startsWith('#')) {
    return null;
  }

  return normalizedPattern;
}

function normalizePathForIgnoreComparison(inputPath: string): string {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return inputPath.toLowerCase();
  }

  return inputPath;
}

function normalizeRelativeIgnorePath(relativePath: string): string {
  let normalizedPath = normalizeDisplayPath(relativePath);
  while (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.slice(1);
  }

  return normalizedPath;
}

function trimTrailingSlashes(inputPath: string): string {
  let normalizedPath = inputPath;
  while (normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  return normalizedPath;
}
