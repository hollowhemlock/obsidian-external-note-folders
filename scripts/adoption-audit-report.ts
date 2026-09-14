import {
  mkdir,
  mkdtemp,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type { AdoptionPlanRow } from '../src/core/adoptionPlan.ts';
import type {
  AuditNote,
  AuditScan
} from './adoption-audit-scan.ts';

import { buildExactPathAdoptionPlan } from '../src/core/adoptionPlan.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from '../src/core/pathPolicy.ts';

export interface AuditReports {
  complete: boolean;
  summary: string;
  tables: Record<string, AuditTable>;
}
export interface AuditTable {
  columns: string[];
  rows: CsvRow[];
}

type AddFinding = (category: string, location: string, uuid: string, reason: string, relatedPath?: string) => void;

type CsvRow = Record<string, string>;

interface NoteReportContext {
  addFinding: AddFinding;
  adopted: CsvRow[];
  complete: boolean;
  expectedPaths: Map<string, string>;
  folders: Set<string>;
  planRows: Map<string, AdoptionPlanRow>;
  problematicFolders: Set<string>;
  scan: AuditScan;
  targetNotes: Map<string, string[]>;
}

export function buildAuditReports(scan: AuditScan): AuditReports {
  const complete = !scan.issues.some((issue) => issue.unchecked);
  const findings: CsvRow[] = [];
  const adopted: CsvRow[] = [];
  const expectedPaths = new Map<string, string>();
  const targetNotes = new Map<string, string[]>();
  const folders = new Set(scan.folders.map(normalizePathForIdentity));
  const markedFolders = new Set(scan.markers.map((marker) => normalizePathForIdentity(marker.folderPath)));
  function addFinding(category: string, location: string, uuid: string, reason: string, relatedPath = ''): void {
    findings.push({ category, confidence: complete ? 'checked' : 'provisional', location, reason, relatedPath, uuid });
  }

  for (const issue of scan.issues) {
    addFinding(issue.unchecked ? 'unchecked' : 'invalid-identity', issue.location, '', issue.reason);
  }
  const problematicFolders = reportMarkers(scan, addFinding);
  for (const [uuid, notes] of scan.vault.duplicatePaths) {
    for (const note of notes) {
      addFinding('duplicate-note-uuid', path.join(scan.vaultRoot, note), uuid, 'UUID appears in multiple notes.');
    }
  }
  for (const [uuid, directories] of scan.external.duplicatePaths) {
    for (const directory of directories) {
      addFinding('duplicate-folder-uuid', directory, uuid, 'UUID appears in multiple external folders.');
    }
  }
  for (const note of scan.notes) {
    try {
      const expected = deriveExternalFolderPath(note.relativePath, scan.externalRoot);
      expectedPaths.set(note.notePath, expected);
      const identity = normalizePathForIdentity(expected);
      const notes = targetNotes.get(identity) ?? [];
      notes.push(note.notePath);
      targetNotes.set(identity, notes);
    } catch {
      addFinding('derived-path-error', note.notePath, note.uuid, 'Plugin cannot derive an external folder for this note path.');
    }
  }

  const plan = buildExactPathAdoptionPlan({
    externalScan: scan.external,
    mutationSequence: 0,
    notePaths: scan.notes.map((note) => note.relativePath),
    vaultScan: scan.vault
  });
  const planRows = new Map(plan.rows.map((row) => [row.notePath, row]));
  for (const error of plan.errors) {
    addFinding('adoption-unchecked', scan.externalRoot, '', error);
  }

  const context: NoteReportContext = { addFinding, adopted, complete, expectedPaths, folders, planRows, problematicFolders, scan, targetNotes };
  for (const note of scan.notes) {
    reportNote(note, context);
  }
  for (const folder of scan.folders) {
    const identity = normalizePathForIdentity(folder);
    if (!markedFolders.has(identity) && !targetNotes.has(identity)) {
      addFinding('unmatched-folder', folder, '', 'No marker or exact note target observed; may be a container or content subfolder.');
    }
  }

  const tables: Record<string, AuditTable> = {
    'correctly-adopted.csv': { columns: ['notePath', 'uuid', 'expectedFolder', 'actualFolder', 'pathDrift'], rows: adopted },
    'exnf-files.csv': { columns: ['markerPath', 'folderPath', 'uuid', 'format', 'status'], rows: scan.markers.map((marker) => ({ ...marker })) },
    'external-folders.csv': { columns: ['folderPath'], rows: scan.folders.map((folderPath) => ({ folderPath })) },
    'markdown-files.csv': { columns: ['notePath'], rows: scan.notes.map((note) => ({ notePath: note.notePath })) },
    'markdown-with-exnf.csv': {
      columns: ['notePath', 'value', 'uuid', 'status'],
      rows: scan.notes.filter((note) => note.hasExnf).map((note) => ({ notePath: note.notePath, status: note.status, uuid: note.uuid, value: note.value }))
    },
    'possibly-missing.csv': { columns: ['category', 'location', 'uuid', 'relatedPath', 'confidence', 'reason'], rows: findings }
  };
  const counts = Map.groupBy(findings, (row) => row['category'] ?? 'unknown');
  const summary = [
    '# Adoption audit',
    '',
    `Vault source: ${scan.vaultRoot}`,
    '',
    `External source: ${scan.externalRoot}`,
    '',
    `Scan coverage: **${complete ? 'complete' : 'incomplete; conclusions are provisional'}**.`,
    '',
    'Filesystem inventory only; no implicit exclusions. Links and junctions are not followed.',
    'This is a live scan, not an atomic snapshot. Files changed during the scan may require another run.',
    'Correctly adopted describes current unambiguous UUID bindings, not their creation history.',
    'Unassigned notes and unmarked folders are review items, not automatic errors.',
    'Property inventories include parsed top-level exnf keys. Unreadable or unparseable frontmatter is listed as unchecked.',
    '',
    '## Reports',
    '',
    ...Object.entries(tables).map(([name, table]) => `- [${name}](${name}): ${String(table.rows.length)} rows`),
    '',
    '## Finding counts',
    '',
    ...[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([category, rows]) => `- ${category}: ${String(rows.length)}`),
    ''
  ].join('\n');
  return { complete, summary, tables };
}

export function serializeAuditCsv(table: AuditTable): string {
  function escapeCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }
  const rows = table.rows.map((row) => table.columns.map((column) => row[column] ?? ''));
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return `\uFEFF${[table.columns, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')}\r\n`;
}

export async function writeAuditReports(reports: AuditReports, outputParent: string): Promise<string> {
  await mkdir(outputParent, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const outputDirectory = await mkdtemp(path.join(outputParent, `adoption-audit-${timestamp}-`));
  for (const [name, table] of Object.entries(reports.tables)) {
    await writeFile(path.join(outputDirectory, name), serializeAuditCsv(table), { encoding: 'utf8', flag: 'wx' });
  }
  await writeFile(path.join(outputDirectory, 'summary.md'), reports.summary, { encoding: 'utf8', flag: 'wx' });
  return outputDirectory;
}

function reportMarkers(scan: AuditScan, addFinding: AddFinding): Set<string> {
  const problematicFolders = new Set<string>();
  const markersByFolder = Map.groupBy(scan.markers, (marker) => normalizePathForIdentity(marker.folderPath));
  for (const [folder, markers] of markersByFolder) {
    if (
      new Set(markers.filter((marker) => marker.uuid !== '').map((marker) => marker.uuid)).size > 1
      || markers.some((marker) => marker.status !== 'valid')
    ) {
      problematicFolders.add(folder);
      for (const marker of markers) {
        addFinding('marker-conflict', marker.markerPath, marker.uuid, 'Folder contains multiple identities or invalid/unchecked marker evidence.');
      }
    }
  }
  for (const marker of scan.markers) {
    if (marker.uuid && !scan.vault.bindings.has(marker.uuid)) {
      addFinding('missing-note', marker.markerPath, marker.uuid, 'No note with this UUID observed.', marker.folderPath);
    }
    if (marker.uuid && marker.format === 'legacy') {
      addFinding('legacy-migration', marker.markerPath, marker.uuid, 'Legacy marker is readable; explicit migration is recommended.');
    }
  }
  return problematicFolders;
}

function reportNote(note: AuditNote, context: NoteReportContext): void {
  const { addFinding, adopted, complete, expectedPaths, problematicFolders, scan, targetNotes } = context;
  const expected = expectedPaths.get(note.notePath) ?? '';
  if (note.status === 'missing-property') {
    reportUnassignedNote(note, expected, context);
    return;
  }
  if (!note.uuid || scan.vault.duplicatePaths.has(note.uuid) || scan.external.duplicatePaths.has(note.uuid)) {
    return;
  }
  const actual = scan.external.bindings.get(note.uuid);
  if (!actual) {
    addFinding('missing-external-marker', note.notePath, note.uuid, 'No matching external marker observed.', expected);
    return;
  }
  if (problematicFolders.has(normalizePathForIdentity(actual))) {
    addFinding('ambiguous-binding', note.notePath, note.uuid, 'Matching folder has conflicting or invalid marker evidence.', actual);
    return;
  }
  if (!expected) {
    return;
  }
  if ((targetNotes.get(normalizePathForIdentity(expected))?.length ?? 0) > 1) {
    addFinding('derived-path-collision', note.notePath, note.uuid, 'Multiple notes derive this expected folder.', expected);
    return;
  }
  const pathDrift = normalizePathForIdentity(expected) !== normalizePathForIdentity(actual);
  if (pathDrift) {
    addFinding('path-drift', note.notePath, note.uuid, `Binding exists at a different path. Expected: ${expected}`, actual);
  }
  if (!complete) {
    addFinding('provisional-binding', note.notePath, note.uuid, 'UUID match observed, but incomplete scan evidence prevents proving uniqueness.', actual);
    return;
  }
  adopted.push({ actualFolder: actual, expectedFolder: expected, notePath: note.notePath, pathDrift: String(pathDrift), uuid: note.uuid });
}

function reportUnassignedNote(note: AuditNote, expected: string, context: NoteReportContext): void {
  const { addFinding, folders, planRows } = context;
  const candidate = planRows.get(note.relativePath);
  if (candidate?.kind === 'adopt') {
    addFinding('adoption-candidate', note.notePath, '', 'Unassigned note has an eligible exact-path folder.', candidate.folderPath);
  } else if (candidate?.kind === 'blocked-note') {
    addFinding('adoption-blocked', note.notePath, '', candidate.message, expected);
  } else if (expected && folders.has(normalizePathForIdentity(expected))) {
    addFinding(
      'adoption-not-selected',
      note.notePath,
      '',
      'Exact folder exists, but the planner did not select this note; a deeper candidate or incomplete evidence may take precedence.',
      expected
    );
  } else {
    addFinding('unassigned-note', note.notePath, '', 'No exnf identity or exact folder observed; an external folder may not be required.', expected);
  }
}
