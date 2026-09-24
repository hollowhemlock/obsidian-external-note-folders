// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation follows ADR-0016; browser queries do not import this module.
import path from 'node:path';

import type { AdoptionPlanRow } from './adoptionPlan.ts';
import type {
  AuditTable,
  CsvRow
} from './auditCsv.ts';
import type {
  AuditNote,
  AuditScan
} from './auditTypes.ts';

import { buildExactPathAdoptionRowsSteps } from './adoptionPlan.ts';
import { finishAuditSteps } from './auditSteps.ts';
import { folderStatusTable } from './folderStatusCsv.ts';
import { unmarkedLeafSteps } from './leafAnalysis.ts';
import { buildLeafReportSteps } from './leafReport.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';
import { templateExclusionSummary } from './templateExclusions.ts';

export interface AuditReports {
  complete: boolean;
  summary: string;
  tables: Record<string, AuditTable>;
}
type AddFinding = (category: string, location: string, uuid: string, reason: string, relatedPath?: string) => void;

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
  return finishAuditSteps(buildAuditReportSteps(scan));
}

export function* buildAuditReportSteps(scan: AuditScan, includeInventories = true): Generator<void, AuditReports> {
  const complete = !scan.issues.some((issue) => issue.unchecked);
  const findings: CsvRow[] = [];
  const adopted: CsvRow[] = [];
  const expectedPaths = new Map<string, string>();
  const targetNotes = new Map<string, string[]>();
  const folders = new Set<string>();
  for (const folder of scan.folders) {
    folders.add(normalizePathForIdentity(folder));
    yield;
  }
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
    yield;
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

  const plan = yield* buildExactPathAdoptionRowsSteps({
    externalScan: scan.external,
    notePaths: scan.notes.map((note) => note.relativePath),
    vaultScan: scan.vault
  });
  const planRows = new Map(plan.rows.map((row) => [row.notePath, row]));
  for (const error of plan.errors) {
    addFinding('adoption-unchecked', scan.externalRoot, '', error);
  }

  const context: NoteReportContext = { addFinding, adopted, complete, expectedPaths, folders, planRows, problematicFolders, scan, targetNotes };
  for (const note of scan.notes) {
    yield;
    reportNote(note, context);
  }
  for (const folder of scan.folders) {
    yield;
    const identity = normalizePathForIdentity(folder);
    if (!markedFolders.has(identity) && !targetNotes.has(identity)) {
      addFinding('unmatched-folder', folder, '', 'No marker or exact note target observed; may be a container or content subfolder.');
    }
  }

  const tables: Record<string, AuditTable> = {
    'correctly-adopted.csv': { columns: ['notePath', 'uuid', 'expectedFolder', 'actualFolder', 'pathDrift'], rows: adopted },
    'possibly-missing.csv': { columns: ['category', 'location', 'uuid', 'relatedPath', 'confidence', 'reason'], rows: findings }
  };
  if (includeInventories) {
    for (const name of INVENTORY_NAMES) {
      tables[name] = yield* buildInventoryTableSteps(scan, name);
    }
  }
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
    templateExclusionSummary(scan.templateExclusions),
    'Filesystem inventory only; no implicit exclusions. Links and junctions are not followed.',
    'This is a live scan, not an atomic snapshot. Files changed during the scan may require another run.',
    'Correctly adopted describes current unambiguous UUID bindings, not their creation history.',
    'Unassigned notes and unmarked folders are review items, not automatic errors.',
    'Property inventories include parsed top-level exnf keys. Unreadable or unparseable frontmatter is listed as unchecked.',
    'Unmarked leaf folders have no subfolders and no .exnf marker anywhere along their path, including the leaf and external root.',
    'That list excludes locally unchecked paths; unrelated vault or external scan gaps do not disqualify checked branches.',
    '',
    '## Reports',
    '',
    ...Object.entries(tables).sort(([a], [b]) => a.localeCompare(b)).map(([name, table]) => `- [${name}](${name}): ${String(table.rows.length)} rows`),
    '',
    '## Finding counts',
    '',
    ...[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([category, rows]) => `- ${category}: ${String(rows.length)}`),
    ''
  ].join('\n');
  return { complete, summary, tables };
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

const INVENTORY_NAMES = [
  'folder-status.csv',
  'exnf-files.csv',
  'external-folders.csv',
  'markdown-files.csv',
  'markdown-with-exnf.csv',
  'unmarked-leaf-folders.csv'
];

/** Build only the requested table; inventory exports do not run adoption analysis. */
export function* buildAuditTableSteps(scan: AuditScan, name: string): Generator<void, AuditTable> {
  if (INVENTORY_NAMES.includes(name)) {
    return yield* buildInventoryTableSteps(scan, name);
  }
  if (name !== 'correctly-adopted.csv' && name !== 'possibly-missing.csv') {
    throw new Error('Unknown audit table');
  }
  const reports = yield* buildAuditReportSteps(scan, false);
  const table = reports.tables[name];
  if (!table) {
    throw new Error('Missing audit table');
  }
  return table;
}

function* buildInventoryTableSteps(scan: AuditScan, name: string): Generator<void, AuditTable> {
  const rows: CsvRow[] = [];
  if (name === 'folder-status.csv') {
    return folderStatusTable((yield* buildLeafReportSteps(scan)).tree ?? []);
  }
  if (name === 'exnf-files.csv') {
    for (const marker of scan.markers) {
      rows.push({ ...marker });
      yield;
    }
    return { columns: ['markerPath', 'folderPath', 'uuid', 'format', 'status'], rows };
  }
  if (name === 'external-folders.csv') {
    for (const folderPath of scan.folders) {
      rows.push({ folderPath });
      yield;
    }
    return { columns: ['folderPath'], rows };
  }
  if (name === 'unmarked-leaf-folders.csv') {
    const leaves = yield* unmarkedLeafSteps(scan);
    for (const folderPath of leaves) {
      rows.push({ folderPath, relativePath: path.relative(scan.externalRoot, folderPath) });
      yield;
    }
    return { columns: ['folderPath', 'relativePath'], rows };
  }
  for (const note of scan.notes) {
    if (name === 'markdown-files.csv') {
      rows.push({ notePath: note.notePath });
    } else if (note.hasExnf) {
      rows.push({ notePath: note.notePath, status: note.status, uuid: note.uuid, value: note.value });
    }
    yield;
  }
  return { columns: name === 'markdown-files.csv' ? ['notePath'] : ['notePath', 'value', 'uuid', 'status'], rows };
}
