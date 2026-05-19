import type {
  ExternalMarkerRecord,
  ExternalScanResult
} from './verify.ts';

import { EXNF_LEGACY_MARKER_FILE_NAME } from './contracts.ts';
import { toExternalRelativeDisplayPath } from './displayPath.ts';
import { formatIgnoredDirectoryWarnings } from './externalRootIgnore.ts';
import { buildExnfMarkerFileName } from './marker.ts';

export interface MarkerMigrationAlreadyMigratedRow {
  externalFolder: string;
  kind: 'already-migrated';
  message: string;
  sourcePath: string;
  targetPath: string;
  uuid: string;
}

export interface MarkerMigrationPlan {
  errors: string[];
  externalRootPath: string;
  hasGlobalErrors: boolean;
  markdownReport: string;
  mutationSequence: number;
  rows: MarkerMigrationPlanRow[];
  summaryText: string;
  warnings: string[];
}

export type MarkerMigrationPlanRow =
  | MarkerMigrationAlreadyMigratedRow
  | MarkerMigrationRenameRow;

export interface MarkerMigrationRenameRow {
  externalFolder: string;
  kind: 'rename';
  sourcePath: string;
  targetPath: string;
  uuid: string;
}

export function buildMarkerMigrationPlan(input: {
  externalScan: ExternalScanResult;
  mutationSequence: number;
}): MarkerMigrationPlan {
  const errors = [
    ...input.externalScan.accessErrors
      .map((issue) => `External root access error at ${issue.location}: ${issue.message}`),
    ...input.externalScan.ignoreErrors
      .map((issue) => `Invalid external root ignore pattern ${issue.pattern}: ${issue.message}`),
    ...input.externalScan.malformedMarkers
      .map((issue) => `Malformed marker at ${issue.location}: ${issue.message}`),
    ...(input.externalScan.markerConflicts ?? [])
      .map((issue) => `Marker conflict at ${issue.location}: ${issue.message}`)
  ].sort();
  const uuidNamedMarkersByFolderAndUuid = buildUuidNamedMarkersByFolderAndUuid(input.externalScan.markers ?? []);
  const rows = sortRows((input.externalScan.legacyMarkers ?? []).map((marker): MarkerMigrationPlanRow => {
    const targetPath = buildLegacyMarkerMigrationTargetPath(marker.markerPath, marker.uuid);
    const externalFolder = toExternalRelativeDisplayPath(input.externalScan.rootPath, marker.folderPath);
    if (uuidNamedMarkersByFolderAndUuid.has(buildFolderUuidKey(marker.folderPath, marker.uuid))) {
      return {
        externalFolder,
        kind: 'already-migrated',
        message: 'Matching UUID-named marker already exists; legacy marker is stale cleanup evidence.',
        sourcePath: marker.markerPath,
        targetPath,
        uuid: marker.uuid
      };
    }

    return {
      externalFolder,
      kind: 'rename',
      sourcePath: marker.markerPath,
      targetPath,
      uuid: marker.uuid
    };
  }));
  const warnings = [
    ...formatIgnoredDirectoryWarnings(input.externalScan.ignoredDirectories),
    ...input.externalScan.skippedDirectories
      .map((issue) => `Skipped external directory at ${issue.location}: ${issue.message}`)
  ].sort();
  const summaryText = [
    `${String(errors.length)} error(s)`,
    `${String(warnings.length)} warning(s)`,
    `${String(rows.filter((row) => row.kind === 'rename').length)} rename(s)`,
    `${String(rows.filter((row) => row.kind === 'already-migrated').length)} already migrated`
  ].join(', ');

  return {
    errors,
    externalRootPath: input.externalScan.rootPath,
    hasGlobalErrors: errors.length > 0,
    markdownReport: buildMarkdownReport({
      errors,
      rows,
      summaryText,
      warnings
    }),
    mutationSequence: input.mutationSequence,
    rows,
    summaryText,
    warnings
  };
}

export function haveSameMarkerMigrationRows(left: MarkerMigrationPlan, right: MarkerMigrationPlan): boolean {
  const leftRenameRows = left.rows.filter((row): row is MarkerMigrationRenameRow => row.kind === 'rename');
  const rightRenameRows = right.rows.filter((row): row is MarkerMigrationRenameRow => row.kind === 'rename');
  if (leftRenameRows.length !== rightRenameRows.length) {
    return false;
  }

  return leftRenameRows.every((leftRow, index) => {
    const rightRow = rightRenameRows[index];
    return leftRow.uuid === rightRow?.uuid
      && leftRow.sourcePath === rightRow.sourcePath
      && leftRow.targetPath === rightRow.targetPath;
  });
}

function buildFolderUuidKey(folderPath: string, uuid: string): string {
  return `${folderPath}\0${uuid}`;
}

function buildLegacyMarkerMigrationTargetPath(markerPath: string, uuid: string): string {
  return `${markerPath.slice(0, -EXNF_LEGACY_MARKER_FILE_NAME.length)}${buildExnfMarkerFileName(uuid)}`;
}

function buildMarkdownReport(input: {
  errors: string[];
  rows: MarkerMigrationPlanRow[];
  summaryText: string;
  warnings: string[];
}): string {
  return [
    '# Legacy Marker Migration Plan',
    '',
    input.summaryText,
    '',
    formatMarkdownList('Errors', input.errors),
    formatMarkdownList('Warnings', input.warnings),
    formatRows('Marker Rows', input.rows)
  ].join('\n');
}

function buildUuidNamedMarkersByFolderAndUuid(markers: readonly ExternalMarkerRecord[]): Set<string> {
  return new Set(
    markers
      .filter((marker) => marker.format === 'uuid-named')
      .map((marker) => buildFolderUuidKey(marker.folderPath, marker.uuid))
  );
}

function formatMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatMarkdownList(title: string, items: readonly string[]): string {
  if (items.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    ...items.map((item) => `- ${formatMarkdownCell(item)}`)
  ].join('\n');
}

function formatRows(title: string, rows: readonly MarkerMigrationPlanRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    '| Kind | External folder | UUID | Source marker | Target marker | Message |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => {
      const message = 'message' in row ? row.message : '';
      return `| ${formatMarkdownCell(row.kind)} | ${formatMarkdownCell(row.externalFolder)} | ${formatMarkdownCell(row.uuid)} | ${
        formatMarkdownCell(row.sourcePath)
      } | ${formatMarkdownCell(row.targetPath)} | ${formatMarkdownCell(message)} |`;
    })
  ].join('\n');
}

function sortRows(rows: MarkerMigrationPlanRow[]): MarkerMigrationPlanRow[] {
  return rows.sort((left, right) => {
    const leftKey = `${left.kind}\0${left.externalFolder}\0${left.uuid}`;
    const rightKey = `${right.kind}\0${right.externalFolder}\0${right.uuid}`;
    return leftKey.localeCompare(rightKey);
  });
}
