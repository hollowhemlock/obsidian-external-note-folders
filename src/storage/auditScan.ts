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

import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import {
  parseLegacyExnfMarkerFile,
  parseUuidNamedExnfMarkerFile
} from '../core/marker.ts';
import { registerUuidBinding } from '../core/scanResult.ts';

export type { AuditScan } from '../core/auditTypes.ts';

const YAML_ALIAS_LIMIT = 100;

export interface AuditScanOptions {
  onProgress?: (counts: { directories: number; markers: number; notes: number }) => void;
  signal?: AbortSignal;
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
  await walk(scan.vaultRoot, 'vault', scan, options);
  await walk(scan.externalRoot, 'external', scan, options);
  options.signal?.throwIfAborted();
  scan.external.directories = scan.folders;
  scan.finishedAt = new Date().toISOString();
  return scan;
}

function recordUnchecked(location: string, reason: string, scope: 'external' | 'vault', scan: AuditScan): void {
  scan.issues.push({ location, reason, unchecked: true });
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
      recordUnchecked(markerPath, 'Legacy marker could not be read.', 'external', scan);
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
    scan.issues.push({ location: markerPath, reason, unchecked: name === '.exnf' });
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
      scan.issues.push({ location: notePath, reason: 'exnf must be a canonical lowercase UUID string.', unchecked: false });
    }
  } catch {
    note.status = 'unchecked-frontmatter';
    scan.vault.invalidFrontmatter.push({ location: note.relativePath, message: 'Unreadable or invalid frontmatter.' });
    scan.issues.push({ location: notePath, reason: 'Note could not be read or its YAML frontmatter could not be parsed safely.', unchecked: true });
  }
}

async function walk(directory: string, scope: 'external' | 'vault', scan: AuditScan, options: AuditScanOptions): Promise<void> {
  try {
    options.signal?.throwIfAborted();
    options.onProgress?.({ directories: scan.folders.length, markers: scan.markers.length, notes: scan.notes.length });
    const info = await lstat(directory);
    if (info.isSymbolicLink()) {
      recordUnchecked(directory, 'Symbolic link or junction was not followed.', scope, scan);
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        recordUnchecked(entryPath, 'Symbolic link or junction was not followed.', scope, scan);
      } else if (entry.isDirectory()) {
        if (scope === 'external') {
          scan.folders.push(entryPath);
        }
        await walk(entryPath, scope, scan, options);
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
