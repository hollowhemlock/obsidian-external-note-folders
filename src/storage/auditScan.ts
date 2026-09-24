import {
  lstat,
  readdir,
  readFile
} from 'node:fs/promises';
import path from 'node:path';
// eslint-disable-next-line import-x/no-extraneous-dependencies -- Standalone audit deliberately uses the existing tooling dependency tree without changing plugin dependencies.
import {
  parseDocument,
  stringify
} from 'yaml';

import type {
  AuditMarker,
  AuditNote,
  AuditScan
} from '../core/auditTypes.ts';

import { buildExternalRootIgnoreMatcher } from '../core/externalRootIgnore.ts';
import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import {
  parseLegacyExnfMarkerFile,
  parseUuidNamedExnfMarkerFile
} from '../core/marker.ts';
import { registerUuidBinding } from '../core/scanResult.ts';
import { buildTemplateExclusionMatcher } from '../core/templateExclusions.ts';

export type { AuditScan } from '../core/auditTypes.ts';

const YAML_ALIAS_LIMIT = 100;

export interface AuditScanOptions {
  ignorePatterns?: readonly string[];
  onProgress?: (counts: { directories: number; markers: number; notes: number }) => void;
  signal?: AbortSignal;
  templateExcludePatterns?: readonly string[];
}

export async function scanAdoptionAudit(vaultRoot: string, externalRoot: string, options: AuditScanOptions = {}): Promise<AuditScan> {
  const scan: AuditScan = {
    external: {
      accessErrors: [],
      bindings: new Map(),
      directories: [],
      duplicatePaths: new Map(),
      ignoredDirectories: [],
      ignoreErrors: [],
      ignorePatterns: [],
      legacyMarkers: [],
      malformedMarkers: [],
      markers: [],
      rootPath: path.resolve(externalRoot),
      skippedDirectories: []
    },
    externalRoot: path.resolve(externalRoot),
    finishedAt: '',
    folders: [],
    issues: [],
    markers: [],
    notes: [],
    startedAt: new Date().toISOString(),
    vault: { bindings: new Map(), duplicatePaths: new Map(), invalidFrontmatter: [] },
    vaultRoot: path.resolve(vaultRoot)
  };
  const matcher = buildExternalRootIgnoreMatcher(scan.externalRoot, options.ignorePatterns ?? []);
  if (matcher.errors.length) {
    // Reject configuration before scanning either root.
    throw new Error('Invalid status ignore patterns.');
  }
  scan.external.ignorePatterns = matcher.patterns;
  const templates = buildTemplateExclusionMatcher(options.templateExcludePatterns);
  scan.templateExclusions = { paths: [], patterns: templates.patterns };
  await walk(scan.vaultRoot, 'vault', scan, options, matcher, templates);
  await walk(scan.externalRoot, 'external', scan, options, matcher, templates);
  options.signal?.throwIfAborted();
  scan.external.directories = scan.folders;
  scan.finishedAt = new Date().toISOString();
  return scan;
}

function excludeTemplatePath(
  scope: 'external' | 'vault',
  entryPath: string,
  directory: boolean,
  scan: AuditScan,
  templates: ReturnType<typeof buildTemplateExclusionMatcher>
): boolean {
  if (scope !== 'vault') {
    return false;
  }
  const relativePath = path.relative(scan.vaultRoot, entryPath).split(path.sep).join('/');
  const excluded = directory ? templates.ignoresRelativeDirectoryPath(relativePath) : templates.ignoresRelativeFilePath(relativePath);
  if (excluded) {
    scan.templateExclusions?.paths.push(relativePath + (directory ? '/' : ''));
  }
  return excluded;
}

function recordUnchecked(
  location: string,
  reason: string,
  scope: 'external' | 'vault',
  scan: AuditScan,
  kind: 'directory' | 'link' | 'marker' = 'directory'
): void {
  scan.issues.push({ kind, location, reason, scope, unchecked: true });
  if (scope === 'external') {
    const issues = location === scan.externalRoot ? scan.external.accessErrors : scan.external.skippedDirectories;
    issues.push({ location, message: reason });
  }
}

async function scanMarker(markerPath: string, scan: AuditScan): Promise<void> {
  const name = path.basename(markerPath);
  const marker: AuditMarker = {
    folderPath: path.dirname(markerPath),
    format: name === '.exnf' ? 'legacy' : 'uuid-named',
    markerPath,
    status: 'invalid-marker',
    uuid: ''
  };
  scan.markers.push(marker);
  let legacyContent = '';
  if (name === '.exnf') {
    try {
      legacyContent = await readFile(markerPath, 'utf8');
    } catch {
      marker.status = 'unchecked-marker';
      recordUnchecked(markerPath, 'Legacy marker could not be read.', 'external', scan, 'marker');
      return;
    }
  }
  try {
    const parsed = name === '.exnf'
      ? parseLegacyExnfMarkerFile(name, legacyContent)
      : parseUuidNamedExnfMarkerFile(name);
    marker.uuid = parsed.uuid;
    marker.status = 'valid';
    const record = { folderPath: marker.folderPath, markerPath, ...parsed };
    scan.external.markers?.push(record);
    if (parsed.format === 'legacy') {
      scan.external.legacyMarkers?.push(record);
    }
    registerUuidBinding(scan.external.bindings, scan.external.duplicatePaths, parsed.uuid, marker.folderPath, { ignoreExactDuplicate: true });
  } catch {
    const reason = 'Malformed marker filename or legacy marker contents.';
    scan.external.malformedMarkers.push({ location: markerPath, message: reason });
    scan.issues.push({ kind: 'marker', location: markerPath, reason, scope: 'external', unchecked: name === '.exnf' });
  }
}

async function scanNote(notePath: string, scan: AuditScan): Promise<void> {
  const note: AuditNote = {
    hasExnf: false,
    notePath,
    relativePath: path.relative(scan.vaultRoot, notePath).split(path.sep).join('/'),
    status: 'missing-property',
    uuid: '',
    value: ''
  };
  scan.notes.push(note);
  try {
    const markdown = (await readFile(notePath, 'utf8')).replace(/^\uFEFF/u, '');
    if (!/^---\r?\n/u.test(markdown)) {
      return;
    }
    const frontmatter = /^---\r?\n(?<frontmatter>[\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(markdown)?.groups?.['frontmatter'];
    if (frontmatter === undefined) {
      throw new Error('Unterminated frontmatter');
    }
    const document = parseDocument(frontmatter, { strict: true, uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new Error('Invalid YAML');
    }
    const parsed: unknown = document.toJS({ mapAsMap: true, maxAliasCount: YAML_ALIAS_LIMIT });
    if (parsed === null) {
      return;
    }
    if (!(parsed instanceof Map)) {
      throw new Error('Frontmatter is not a mapping');
    }
    note.hasExnf = parsed.has('exnf');
    if (!note.hasExnf) {
      return;
    }
    const value: unknown = parsed.get('exnf');
    const mapping = { exnf: value };
    note.value = typeof value === 'string' ? value : stringify(value).trimEnd();
    const identity = getExnfFrontmatterValue(mapping);
    if (identity.kind === 'valid') {
      note.uuid = identity.uuid;
      note.status = 'valid';
      registerUuidBinding(scan.vault.bindings, scan.vault.duplicatePaths, identity.uuid, note.relativePath);
    } else {
      note.status = 'invalid-property';
      scan.vault.invalidFrontmatter.push({ location: note.relativePath, message: 'Invalid exnf property.' });
      scan.issues.push({ kind: 'note', location: notePath, reason: 'exnf must be a canonical lowercase UUID string.', scope: 'vault', unchecked: false });
    }
  } catch {
    note.status = 'unchecked-frontmatter';
    scan.vault.invalidFrontmatter.push({ location: note.relativePath, message: 'Unreadable or invalid frontmatter.' });
    scan.issues.push({
      kind: 'note',
      location: notePath,
      reason: 'Note could not be read or its YAML frontmatter could not be parsed safely.',
      scope: 'vault',
      unchecked: true
    });
  }
}

async function walk(
  directory: string,
  scope: 'external' | 'vault',
  scan: AuditScan,
  options: AuditScanOptions,
  matcher: ReturnType<typeof buildExternalRootIgnoreMatcher>,
  templates: ReturnType<typeof buildTemplateExclusionMatcher>
): Promise<void> {
  try {
    options.signal?.throwIfAborted();
    options.onProgress?.({ directories: scan.folders.length, markers: scan.markers.length, notes: scan.notes.length });
    if (
      scope === 'external' && directory !== scan.externalRoot
      && matcher.ignoresAbsoluteDirectoryPath(directory)
    ) {
      scan.external.ignoredDirectories.push({ folderPath: directory, relativePath: path.relative(scan.externalRoot, directory) });
      recordUnchecked(directory, 'Excluded from scan by command-specific patterns.', scope, scan);
      return;
    }
    const info = await lstat(directory);
    if (info.isSymbolicLink()) {
      recordUnchecked(directory, 'Symbolic link or junction was not followed.', scope, scan, 'link');
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      const entryPath = path.join(directory, entry.name);
      if (excludeTemplatePath(scope, entryPath, entry.isDirectory(), scan, templates)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        recordUnchecked(entryPath, 'Symbolic link or junction was not followed.', scope, scan, 'link');
      } else if (entry.isDirectory()) {
        if (scope === 'external') {
          scan.folders.push(entryPath);
        }
        await walk(entryPath, scope, scan, options, matcher, templates);
      } else if (entry.isFile()) {
        if (scope === 'vault' && entry.name.toLowerCase().endsWith('.md')) {
          await scanNote(entryPath, scan);
        } else if (scope === 'external' && entry.name.toLowerCase().endsWith('.exnf')) {
          await scanMarker(entryPath, scan);
        }
      }
    }
  } catch {
    options.signal?.throwIfAborted();
    recordUnchecked(directory, 'Directory could not be fully read.', scope, scan);
  }
}
