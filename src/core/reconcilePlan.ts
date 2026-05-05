import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import {
  normalizeDisplayPath,
  toExternalRelativeDisplayPath
} from './displayPath.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';
import { buildVerifyReport } from './verify.ts';

export interface ReconcileAlreadyCorrectRow {
  currentExternalFolder: string;
  kind: 'already-correct';
  notePath: string;
  targetExternalFolder: string;
  uuid: string;
}

export interface ReconcileConflictInput {
  currentExternalFolder: null | string;
  message: string;
  notePath: string;
  reason: ReconcileConflictReason;
  targetExternalFolder: string;
  uuid: string;
}

export type ReconcileConflictReason =
  | 'ancestor-bound-folder'
  | 'descendant-bound-folder'
  | 'source-missing'
  | 'source-outside-root'
  | 'target-bound-to-different-uuid'
  | 'target-has-malformed-marker'
  | 'target-outside-root'
  | 'target-unmarked-occupied';

export interface ReconcileConflictRow {
  currentExternalFolder: null | string;
  kind: 'conflict';
  message: string;
  notePath: string;
  reason: ReconcileConflictReason;
  targetExternalFolder: string;
  uuid: string;
}

export interface ReconcileMoveRow {
  currentExternalFolder: string;
  kind: 'move';
  notePath: string;
  sourcePath: string;
  targetExternalFolder: string;
  targetPath: string;
  uuid: string;
}

export interface ReconcileOrphanRow {
  currentExternalFolder: string;
  kind: 'orphan';
  uuid: string;
}

export interface ReconcilePlan {
  errors: string[];
  externalRootPath: string;
  hasGlobalErrors: boolean;
  markdownReport: string;
  mutationSequence: number;
  rows: ReconcilePlanRow[];
  summaryText: string;
  warnings: string[];
}

export type ReconcilePlanRow =
  | ReconcileAlreadyCorrectRow
  | ReconcileConflictRow
  | ReconcileMoveRow
  | ReconcileOrphanRow
  | ReconcileUnavailableRow;

export interface ReconcileUnavailableRow {
  kind: 'unavailable';
  notePath: string;
  targetExternalFolder: string;
  uuid: string;
}

interface MarkerTopologyConflict {
  message: string;
  reason: Extract<ReconcileConflictReason, 'ancestor-bound-folder' | 'descendant-bound-folder'>;
}

interface PlannerContext {
  bindingUuidsByIdentity: Map<string, string>;
  directoryIdentities: Set<string>;
  externalScan: ExternalScanResult;
  malformedMarkerParentIdentities: Set<string>;
  rootIdentity: string;
}

export function buildReconcilePlan(input: {
  externalScan: ExternalScanResult;
  mutationSequence: number;
  vaultScan: VaultScanResult;
}): ReconcilePlan {
  const verifyReport = buildVerifyReport(input.vaultScan, input.externalScan);
  const rows: ReconcilePlanRow[] = [];

  if (!verifyReport.hasIntegrityErrors) {
    const context = buildPlannerContext(input.externalScan);
    for (const [uuid, notePath] of sortEntries(input.vaultScan.bindings)) {
      rows.push(buildVaultRow({
        context,
        notePath,
        uuid
      }));
    }

    for (const [uuid, folderPath] of sortEntries(input.externalScan.bindings)) {
      if (!input.vaultScan.bindings.has(uuid)) {
        rows.push({
          currentExternalFolder: toExternalRelativeDisplayPath(input.externalScan.rootPath, folderPath),
          kind: 'orphan',
          uuid
        });
      }
    }
  }

  const sortedRows = sortRows(rows);
  const summaryText = buildSummaryText(verifyReport.errors, verifyReport.warnings, sortedRows);
  return {
    errors: verifyReport.errors,
    externalRootPath: input.externalScan.rootPath,
    hasGlobalErrors: verifyReport.hasIntegrityErrors,
    markdownReport: buildMarkdownReport({
      errors: verifyReport.errors,
      rows: sortedRows,
      summaryText,
      warnings: verifyReport.warnings
    }),
    mutationSequence: input.mutationSequence,
    rows: sortedRows,
    summaryText,
    warnings: verifyReport.warnings
  };
}

function buildBindingUuidsByIdentity(bindings: Map<string, string>): Map<string, string> {
  const uuidsByIdentity = new Map<string, string>();
  for (const [uuid, folderPath] of bindings) {
    uuidsByIdentity.set(normalizePathForIdentity(folderPath), uuid);
  }
  return uuidsByIdentity;
}

function buildConflict(input: ReconcileConflictInput): ReconcileConflictRow {
  return {
    ...input,
    kind: 'conflict'
  };
}

function buildMarkdownReport(input: {
  errors: string[];
  rows: ReconcilePlanRow[];
  summaryText: string;
  warnings: string[];
}): string {
  return [
    '# Reconcile Plan',
    '',
    input.summaryText,
    '',
    formatMarkdownList('Errors', input.errors),
    formatMarkdownList('Warnings', input.warnings),
    formatRows('Moves', input.rows.filter((row): row is ReconcileMoveRow => row.kind === 'move')),
    formatRows('Conflicts', input.rows.filter((row): row is ReconcileConflictRow => row.kind === 'conflict')),
    formatRows('Already Correct', input.rows.filter((row): row is ReconcileAlreadyCorrectRow => row.kind === 'already-correct')),
    formatRows('Unavailable', input.rows.filter((row): row is ReconcileUnavailableRow => row.kind === 'unavailable')),
    formatRows('Orphans', input.rows.filter((row): row is ReconcileOrphanRow => row.kind === 'orphan'))
  ].join('\n');
}

function buildPlannerContext(externalScan: ExternalScanResult): PlannerContext {
  return {
    bindingUuidsByIdentity: buildBindingUuidsByIdentity(externalScan.bindings),
    directoryIdentities: new Set(externalScan.directories.map((directoryPath) => normalizePathForIdentity(directoryPath))),
    externalScan,
    malformedMarkerParentIdentities: new Set(externalScan.malformedMarkers.map((issue) => normalizePathForIdentity(getParentPath(issue.location)))),
    rootIdentity: normalizePathForIdentity(externalScan.rootPath)
  };
}

function buildSummaryText(errors: string[], warnings: string[], rows: readonly ReconcilePlanRow[]): string {
  return [
    `${String(errors.length)} error(s)`,
    `${String(warnings.length)} warning(s)`,
    `${String(rows.filter((row) => row.kind === 'move').length)} move(s)`,
    `${String(rows.filter((row) => row.kind === 'conflict').length)} conflict(s)`,
    `${String(rows.filter((row) => row.kind === 'already-correct').length)} already correct`,
    `${String(rows.filter((row) => row.kind === 'unavailable').length)} unavailable`,
    `${String(rows.filter((row) => row.kind === 'orphan').length)} orphan(s)`
  ].join(', ');
}

function buildVaultRow(input: {
  context: PlannerContext;
  notePath: string;
  uuid: string;
}): ReconcilePlanRow {
  const targetPath = deriveExternalFolderPath(input.notePath, input.context.externalScan.rootPath);
  const targetExternalFolder = toExternalRelativeDisplayPath(input.context.externalScan.rootPath, targetPath);
  const sourcePath = input.context.externalScan.bindings.get(input.uuid);

  if (!sourcePath) {
    return {
      kind: 'unavailable',
      notePath: input.notePath,
      targetExternalFolder,
      uuid: input.uuid
    };
  }

  const currentExternalFolder = toExternalRelativeDisplayPath(input.context.externalScan.rootPath, sourcePath);
  if (!isWithinRoot(input.context.externalScan.rootPath, sourcePath)) {
    return buildConflict({
      currentExternalFolder,
      message: 'Source folder is outside the configured external root.',
      notePath: input.notePath,
      reason: 'source-outside-root',
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  if (!isWithinRoot(input.context.externalScan.rootPath, targetPath)) {
    return buildConflict({
      currentExternalFolder,
      message: 'Target folder is outside the configured external root.',
      notePath: input.notePath,
      reason: 'target-outside-root',
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  if (normalizePathForIdentity(sourcePath) === normalizePathForIdentity(targetPath)) {
    return {
      currentExternalFolder,
      kind: 'already-correct',
      notePath: input.notePath,
      targetExternalFolder,
      uuid: input.uuid
    };
  }

  const sourceIdentity = normalizePathForIdentity(sourcePath);
  if (!input.context.directoryIdentities.has(sourceIdentity)) {
    return buildConflict({
      currentExternalFolder,
      message: 'Source folder is missing from the external root snapshot.',
      notePath: input.notePath,
      reason: 'source-missing',
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  const targetIdentity = normalizePathForIdentity(targetPath);
  const targetBindingUuid = input.context.bindingUuidsByIdentity.get(targetIdentity);
  if (targetBindingUuid && targetBindingUuid !== input.uuid) {
    return buildConflict({
      currentExternalFolder,
      message: `Target folder is already bound to UUID ${targetBindingUuid}.`,
      notePath: input.notePath,
      reason: 'target-bound-to-different-uuid',
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  if (input.context.malformedMarkerParentIdentities.has(targetIdentity)) {
    return buildConflict({
      currentExternalFolder,
      message: 'Target folder contains a malformed marker.',
      notePath: input.notePath,
      reason: 'target-has-malformed-marker',
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  const markerConflict = findMarkerTopologyConflict(input.context, sourcePath, targetPath, input.uuid);
  if (markerConflict) {
    return buildConflict({
      currentExternalFolder,
      message: markerConflict.message,
      notePath: input.notePath,
      reason: markerConflict.reason,
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  if (input.context.directoryIdentities.has(targetIdentity)) {
    return buildConflict({
      currentExternalFolder,
      message: 'Target folder already exists without a valid binding for this UUID.',
      notePath: input.notePath,
      reason: 'target-unmarked-occupied',
      targetExternalFolder,
      uuid: input.uuid
    });
  }

  return {
    currentExternalFolder,
    kind: 'move',
    notePath: input.notePath,
    sourcePath,
    targetExternalFolder,
    targetPath,
    uuid: input.uuid
  };
}

function findMarkerTopologyConflict(
  context: PlannerContext,
  sourcePath: string,
  targetPath: string,
  uuid: string
): MarkerTopologyConflict | null {
  const sourceIdentity = normalizePathForIdentity(sourcePath);
  const targetIdentity = normalizePathForIdentity(targetPath);

  for (const [boundUuid, boundFolderPath] of context.externalScan.bindings) {
    if (boundUuid === uuid) {
      continue;
    }

    const boundIdentity = normalizePathForIdentity(boundFolderPath);
    if (boundIdentity === sourceIdentity) {
      continue;
    }

    if (isPathInsideIdentity(context.rootIdentity, targetIdentity, boundIdentity)) {
      return {
        message: `Target folder is inside a folder bound to UUID ${boundUuid}.`,
        reason: 'ancestor-bound-folder'
      };
    }

    if (isPathInsideIdentity(context.rootIdentity, boundIdentity, targetIdentity)) {
      return {
        message: `A descendant folder is already bound to UUID ${boundUuid}.`,
        reason: 'descendant-bound-folder'
      };
    }
  }

  return null;
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

function formatRows(title: string, rows: readonly ReconcilePlanRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\nNone.`;
  }

  return [
    `## ${title}`,
    '',
    '| Kind | Vault file | Current external folder | Target external folder | UUID | Message |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => {
      const currentExternalFolder = 'currentExternalFolder' in row ? row.currentExternalFolder : null;
      const targetExternalFolder = 'targetExternalFolder' in row ? row.targetExternalFolder : null;
      const notePath = 'notePath' in row ? row.notePath : null;
      const message = 'message' in row ? row.message : '';
      return `| ${formatMarkdownCell(row.kind)} | ${formatMarkdownCell(notePath ?? '-')} | ${formatMarkdownCell(currentExternalFolder ?? '-')} | ${
        formatMarkdownCell(targetExternalFolder ?? '-')
      } | ${formatMarkdownCell(row.uuid)} | ${formatMarkdownCell(message)} |`;
    })
  ].join('\n');
}

function getParentPath(inputPath: string): string {
  const normalizedPath = normalizeDisplayPath(inputPath);
  const segments = normalizedPath.split('/');
  segments.pop();
  return segments.join('/');
}

function isPathInsideIdentity(rootIdentity: string, childIdentity: string, parentIdentity: string): boolean {
  if (parentIdentity === rootIdentity || childIdentity === parentIdentity) {
    return false;
  }

  const normalizedChildIdentity = normalizeDisplayPath(childIdentity);
  const normalizedParentIdentity = normalizeDisplayPath(parentIdentity);
  const parentPrefix = normalizedParentIdentity.endsWith('/') ? normalizedParentIdentity : `${normalizedParentIdentity}/`;
  return normalizedChildIdentity.startsWith(parentPrefix);
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const normalizedRootPath = normalizeDisplayPath(rootPath).replace(/\/+$/u, '');
  const normalizedCandidatePath = normalizeDisplayPath(candidatePath);
  return normalizedCandidatePath.startsWith(`${normalizedRootPath}/`);
}

function sortEntries<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
}

function sortRows(rows: ReconcilePlanRow[]): ReconcilePlanRow[] {
  return rows.sort((left, right) => {
    const leftNotePath = 'notePath' in left ? left.notePath : '';
    const rightNotePath = 'notePath' in right ? right.notePath : '';
    const leftTarget = 'targetExternalFolder' in left ? left.targetExternalFolder : '';
    const rightTarget = 'targetExternalFolder' in right ? right.targetExternalFolder : '';
    return `${left.kind}\0${leftNotePath}\0${leftTarget}\0${left.uuid}`.localeCompare(`${right.kind}\0${rightNotePath}\0${rightTarget}\0${right.uuid}`);
  });
}
