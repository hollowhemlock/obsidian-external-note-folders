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
import type { GitIgnoreRepository } from './gitStatusIgnore.ts';

import { buildExternalRootIgnoreMatcher } from '../core/externalRootIgnore.ts';
import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import {
  parseLegacyExnfMarkerFile,
  parseUuidNamedExnfMarkerFile
} from '../core/marker.ts';
import {
  assertPathIsWithinRoot,
  normalizePathForIdentity
} from '../core/pathPolicy.ts';
import { registerUuidBinding } from '../core/scanResult.ts';
import { buildTemplateExclusionMatcher } from '../core/templateExclusions.ts';
import {
  findRepositoryRoot,
  GitFilteringError,
  GitRepositoryValidationError,
  GitStatusIgnore
} from './gitStatusIgnore.ts';

export type { AuditScan } from '../core/auditTypes.ts';

const YAML_ALIAS_LIMIT = 100;

export interface AuditScanOptions {
  adoptionTargets?: readonly string[];
  ignorePatterns?: readonly string[];
  knownMarkerPaths?: readonly string[];
  onProgress?: (counts: { directories: number; markers: number; notes: number }) => void;
  signal?: AbortSignal;
  statusScanMode?: import('../core/auditTypes.ts').StatusScanMode;
  templateExcludePatterns?: readonly string[];
}

export async function scanAdoptionAudit(vaultRoot: string, externalRoot: string, options: AuditScanOptions = {}): Promise<AuditScan> {
  const scan: AuditScan = {
    ...(options.statusScanMode ? { repositoryRoots: [] } : {}),
    ...(options.statusScanMode ? { statusScanMode: options.statusScanMode } : {}),
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
  const matcher = buildExternalRootIgnoreMatcher(scan.externalRoot, options.statusScanMode === 'unfiltered' ? [] : options.ignorePatterns ?? []);
  if (matcher.errors.length) {
    // Reject configuration before scanning either root.
    throw new Error('Invalid status ignore patterns.');
  }
  scan.external.ignorePatterns = matcher.patterns;
  const templates = buildTemplateExclusionMatcher(options.templateExcludePatterns);
  for (const target of options.adoptionTargets ?? []) {
    assertPathIsWithinRoot(scan.externalRoot, target);
  }
  scan.templateExclusions = { paths: [], patterns: templates.patterns };
  const git = options.statusScanMode === 'filtered' ? new GitStatusIgnore(options.signal) : undefined;
  try {
    const repository = await git?.initialize(scan.externalRoot) ?? null;
    if (scan.repositoryRoots) {
      // Optional label discovery must not make unfiltered scans depend on ancestor metadata access.
      addRepositoryRoot(scan, repository?.root ?? await findRepositoryRoot(scan.externalRoot).catch(() => null));
    }
    await walk(scan.vaultRoot, 'vault', scan, options, matcher, templates);
    await walk(scan.externalRoot, 'external', scan, options, matcher, templates, git, repository);
    for (const markerPath of options.knownMarkerPaths ?? []) {
      await inspectKnownMarker(markerPath, scan, options);
    }
    await git?.finish();
  } finally {
    git?.dispose();
  }
  options.signal?.throwIfAborted();
  scan.external.directories = scan.folders;
  scan.finishedAt = new Date().toISOString();
  return scan;
}

function addRepositoryRoot(scan: AuditScan, directory: null | string): void {
  if (directory && !scan.repositoryRoots?.includes(directory)) {
    scan.repositoryRoots?.push(directory);
  }
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

function inAdoptionScope(directory: string, options: AuditScanOptions): boolean {
  const current = normalizePathForIdentity(directory);
  return !options.adoptionTargets || options.adoptionTargets.some((target) => {
    const selected = normalizePathForIdentity(target);
    return current === selected || current.startsWith(selected + path.sep) || selected.startsWith(current + path.sep);
  });
}

async function inspectKnownMarker(markerPath: string, scan: AuditScan, options: AuditScanOptions): Promise<void> {
  assertPathIsWithinRoot(scan.externalRoot, markerPath);
  if (!markerPath.toLowerCase().endsWith('.exnf')) {
    throw new Error('Known marker path is invalid.');
  }
  let current = scan.externalRoot;
  try {
    for (const segment of ['', ...path.relative(scan.externalRoot, path.dirname(markerPath)).split(path.sep).filter(Boolean)]) {
      options.signal?.throwIfAborted();
      current = path.join(current, segment);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Known marker location is unsafe: ${current}`);
      }
    }
    // Recheck the entire known location, including replacement/malformed marker evidence.
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (!entry.name.toLowerCase().endsWith('.exnf')) {
        continue;
      }
      const found = path.join(current, entry.name);
      if (!entry.isFile()) {
        recordUnchecked(found, 'Known marker is not a regular file.', 'external', scan, 'marker');
      } else if (!scan.markers.some((marker) => marker.markerPath === found)) {
        await scanMarker(found, scan);
      }
    }
  } catch (error: unknown) {
    options.signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      recordUnchecked(markerPath, `Known marker could not be checked: ${String(error)}`, 'external', scan, 'marker');
    }
  }
}

/** False means the directory was excluded or recorded as unchecked before reading entries. */
async function loadRepository(
  directory: string,
  scan: AuditScan,
  options: AuditScanOptions,
  git: GitStatusIgnore,
  parent: GitIgnoreRepository | null
): Promise<false | GitIgnoreRepository | null> {
  // A failure querying the parent belongs to that live context, not child validation.
  const reason = directory === scan.externalRoot ? null : await parent?.ignores(directory);
  if (reason) {
    scan.external.ignoredDirectories.push({ folderPath: directory, relativePath: path.relative(scan.externalRoot, directory) });
    recordUnchecked(directory, reason, 'external', scan, 'directory', 'git');
    return false;
  }
  try {
    const context = await git.context(directory, parent);
    if (context?.root === directory) {
      addRepositoryRoot(scan, directory);
    }
    return context;
  } catch (error: unknown) {
    options.signal?.throwIfAborted();
    if (!(error instanceof GitRepositoryValidationError) || directory === scan.externalRoot) {
      throw error;
    }
    addRepositoryRoot(scan, directory);
    recordUnchecked(
      directory,
      `Skipped repository: Git could not validate its metadata. ${error.message}`,
      'external',
      scan,
      'directory',
      undefined,
      'git-repository-unavailable'
    );
    return false;
  }
}

function recordUnchecked(
  location: string,
  reason: string,
  scope: 'external' | 'vault',
  scan: AuditScan,
  kind: 'directory' | 'link' | 'marker' = 'directory',
  exclusionSource?: 'git' | 'metadata' | 'settings',
  code?: import('../core/auditTypes.ts').AuditIssue['code']
): void {
  scan.issues.push({ kind, location, reason, scope, unchecked: true, ...(exclusionSource ? { exclusionSource } : {}), ...(code ? { code } : {}) });
  if (scope === 'external') {
    const issues = location === scan.externalRoot ? scan.external.accessErrors : scan.external.skippedDirectories;
    issues.push({ location, message: reason });
  }
}

async function scanLink(
  entryPath: string,
  scope: 'external' | 'vault',
  scan: AuditScan,
  matcher: ReturnType<typeof buildExternalRootIgnoreMatcher>,
  git?: GitStatusIgnore,
  repository?: GitIgnoreRepository | null
): Promise<void> {
  if (scope === 'external' && git && !entryPath.toLowerCase().endsWith('.exnf')) {
    if (matcher.ignoresAbsoluteDirectoryPath(entryPath)) {
      recordUnchecked(entryPath, 'Excluded from scan by shared external-folder patterns.', scope, scan, 'link', 'settings');
      return;
    }
    const reason = await repository?.ignores(entryPath);
    if (reason) {
      recordUnchecked(entryPath, reason, scope, scan, 'link', 'git');
      return;
    }
  }
  recordUnchecked(entryPath, 'Symbolic link or junction was not followed.', scope, scan, 'link');
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

function skipAdoptionEntry(
  entry: { isDirectory: () => boolean; isSymbolicLink: () => boolean },
  entryPath: string,
  scope: string,
  options: AuditScanOptions
): boolean {
  return scope === 'external' && (entry.isDirectory() || entry.isSymbolicLink()) && !inAdoptionScope(entryPath, options);
}

async function walk(
  directory: string,
  scope: 'external' | 'vault',
  scan: AuditScan,
  options: AuditScanOptions,
  matcher: ReturnType<typeof buildExternalRootIgnoreMatcher>,
  templates: ReturnType<typeof buildTemplateExclusionMatcher>,
  git?: GitStatusIgnore,
  repository: GitIgnoreRepository | null = null
): Promise<void> {
  try {
    options.signal?.throwIfAborted();
    options.onProgress?.({ directories: scan.folders.length, markers: scan.markers.length, notes: scan.notes.length });
    if (
      scope === 'external' && directory !== scan.externalRoot
      && matcher.ignoresAbsoluteDirectoryPath(directory)
    ) {
      scan.external.ignoredDirectories.push({ folderPath: directory, relativePath: path.relative(scan.externalRoot, directory) });
      recordUnchecked(directory, 'Excluded from scan by shared external-folder patterns.', scope, scan, 'directory', 'settings');
      return;
    }
    if (git && directory !== scan.externalRoot && path.basename(directory) === '.git') {
      scan.external.ignoredDirectories.push({ folderPath: directory, relativePath: path.relative(scan.externalRoot, directory) });
      recordUnchecked(directory, 'Git metadata excluded from filtered status scans.', scope, scan, 'directory', 'metadata');
      return;
    }
    const info = await lstat(directory);
    if (info.isSymbolicLink()) {
      recordUnchecked(directory, 'Symbolic link or junction was not followed.', scope, scan, 'link');
      return;
    }
    if (git) {
      const context = await loadRepository(directory, scan, options, git, repository);
      if (context === false) {
        return;
      }
      repository = context;
    }
    await walkEntries(directory, scope, scan, options, matcher, templates, git, repository);
    if (repository?.root === directory) {
      await repository.finish();
    }
  } catch (error: unknown) {
    options.signal?.throwIfAborted();
    if (error instanceof GitFilteringError) {
      throw error;
    }
    recordUnchecked(directory, 'Directory could not be fully read.', scope, scan);
  }
}

async function walkEntries(
  directory: string,
  scope: 'external' | 'vault',
  scan: AuditScan,
  options: AuditScanOptions,
  matcher: ReturnType<typeof buildExternalRootIgnoreMatcher>,
  templates: ReturnType<typeof buildTemplateExclusionMatcher>,
  git?: GitStatusIgnore,
  repository: GitIgnoreRepository | null = null
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    scope === 'external'
    && entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))
  ) {
    addRepositoryRoot(scan, directory);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    options.signal?.throwIfAborted();
    const entryPath = path.join(directory, entry.name);
    if (skipAdoptionEntry(entry, entryPath, scope, options)) {
      continue;
    }
    if (excludeTemplatePath(scope, entryPath, entry.isDirectory(), scan, templates)) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      await scanLink(entryPath, scope, scan, matcher, git, repository);
    } else if (entry.isDirectory()) {
      if (options.adoptionTargets && scope === 'external' && entry.name.toLowerCase().endsWith('.exnf')) {
        recordUnchecked(entryPath, 'Marker path is not a regular file.', scope, scan, 'marker');
      }
      if (scope === 'external') {
        scan.folders.push(entryPath);
      }
      await walk(entryPath, scope, scan, options, matcher, templates, git, repository);
    } else if (entry.isFile()) {
      if (scope === 'vault' && entry.name.toLowerCase().endsWith('.md')) {
        await scanNote(entryPath, scan);
      } else if (scope === 'external' && entry.name.toLowerCase().endsWith('.exnf')) {
        await scanMarker(entryPath, scan);
      }
    }
  }
}
