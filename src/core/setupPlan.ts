import type { ExnfFrontmatterValue } from './frontmatter.ts';
import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export type SetupAction =
  | 'block'
  | 'confirm-marker-restore'
  | 'confirm-unmarked-adoption'
  | 'create-new'
  | 'open-existing';

export interface SetupPlan {
  action: SetupAction;
  errors: string[];
  externalRootPath: string;
  ignoredDirectoryCount: number;
  legacyMarkerPaths: string[];
  mutationSequence: number;
  notePath: string;
  targetPath: string;
  uuid: null | string;
}

export interface SetupTargetInspection {
  ancestorMarkerPaths: string[];
  descendantMarkerPaths: string[];
  directoryPaths: string[];
  errors: string[];
  externalRootPath: string;
  ignoredDirectories: string[];
  legacyMarkerPaths: string[];
  skippedDirectories: string[];
  targetIgnored: boolean;
  targetKind: 'directory' | 'missing';
  targetMarkerUuids: string[];
  targetPath: string;
}

export function buildSetupPlan(input: {
  identity: ExnfFrontmatterValue;
  inspection: null | SetupTargetInspection;
  mutationSequence: number;
  notePath: string;
  notePaths: readonly string[];
  vaultScan: VaultScanResult;
}): SetupPlan {
  if (input.identity.kind === 'invalid') {
    return blockPlan(input, [`Cannot set up an external folder because exnf frontmatter ${input.identity.reason}.`]);
  }

  if (input.identity.kind === 'valid') {
    return {
      action: 'open-existing',
      errors: [],
      externalRootPath: input.inspection?.externalRootPath ?? '',
      ignoredDirectoryCount: 0,
      legacyMarkerPaths: [],
      mutationSequence: input.mutationSequence,
      notePath: input.notePath,
      targetPath: input.inspection?.targetPath ?? '',
      uuid: input.identity.uuid
    };
  }

  const inspection = input.inspection;
  if (!inspection) {
    return blockPlan(input, ['External folder setup inspection is required.']);
  }

  const errors = collectTopologyErrors(inspection);
  if (errors.length > 0) {
    return blockPlan(input, errors, inspection);
  }

  if (inspection.targetKind === 'missing') {
    return actionPlan(input, inspection, 'create-new', null);
  }

  if (inspection.targetMarkerUuids.length > 1) {
    return blockPlan(input, [`The expected folder contains multiple marker identities: ${inspection.targetMarkerUuids.join(', ')}`], inspection);
  }

  if (inspection.targetMarkerUuids.length === 1) {
    const uuid = inspection.targetMarkerUuids[0] ?? null;
    if (!uuid) {
      return blockPlan(input, ['Unable to identify the expected folder marker.'], inspection);
    }
    if (input.vaultScan.bindings.has(uuid) || input.vaultScan.duplicatePaths.has(uuid)) {
      return blockPlan(input, [`Marker UUID ${uuid} already belongs to a vault note.`], inspection);
    }
    return actionPlan(input, inspection, 'confirm-marker-restore', uuid);
  }

  const directoryIdentities = new Set(inspection.directoryPaths.map(normalizePathForIdentity));
  const hasDeeperExactCandidate = input.notePaths
    .filter((notePath) => notePath !== input.notePath)
    .map((notePath) => deriveExternalFolderPath(notePath, inspection.externalRootPath))
    .some((folderPath) => directoryIdentities.has(normalizePathForIdentity(folderPath)));
  if (hasDeeperExactCandidate) {
    return blockPlan(input, ['A deeper exact note/folder candidate must be set up first.'], inspection);
  }

  return actionPlan(input, inspection, 'confirm-unmarked-adoption', null);
}

export function haveSameSetupPlan(left: SetupPlan, right: SetupPlan): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateSetupRestoration(
  plan: SetupPlan,
  externalScan: ExternalScanResult,
  vaultScan: VaultScanResult
): SetupPlan {
  if (plan.action !== 'confirm-marker-restore' || !plan.uuid) {
    return plan;
  }

  const errors: string[] = [];
  if (externalScan.accessErrors.length > 0) {
    errors.push('The external root could not be scanned completely.');
  }
  if (externalScan.ignoreErrors.length > 0) {
    errors.push('External root ignore settings are invalid.');
  }
  if (externalScan.skippedDirectories.length > 0) {
    errors.push('Marker uniqueness cannot be proven because external directories were skipped.');
  }

  const singleMatch = externalScan.bindings.get(plan.uuid);
  const matches = externalScan.duplicatePaths.get(plan.uuid)
    ?? (singleMatch ? [singleMatch] : []);
  if (
    matches.length !== 1
    || normalizePathForIdentity(matches[0] ?? '') !== normalizePathForIdentity(plan.targetPath)
  ) {
    errors.push(`Marker UUID ${plan.uuid} must occur exactly once at the expected folder.`);
  }
  if (vaultScan.bindings.has(plan.uuid) || vaultScan.duplicatePaths.has(plan.uuid)) {
    errors.push(`Marker UUID ${plan.uuid} already belongs to a vault note.`);
  }

  return {
    ...plan,
    action: errors.length > 0 ? 'block' : plan.action,
    errors: [...plan.errors, ...errors],
    ignoredDirectoryCount: externalScan.ignoredDirectories.length
  };
}

function actionPlan(
  input: Parameters<typeof buildSetupPlan>[0],
  inspection: SetupTargetInspection,
  action: Exclude<SetupAction, 'block' | 'open-existing'>,
  uuid: null | string
): SetupPlan {
  return {
    action,
    errors: [],
    externalRootPath: inspection.externalRootPath,
    ignoredDirectoryCount: inspection.ignoredDirectories.length,
    legacyMarkerPaths: inspection.legacyMarkerPaths,
    mutationSequence: input.mutationSequence,
    notePath: input.notePath,
    targetPath: inspection.targetPath,
    uuid
  };
}

function blockPlan(
  input: Parameters<typeof buildSetupPlan>[0],
  errors: string[],
  inspection: null | SetupTargetInspection = input.inspection
): SetupPlan {
  return {
    action: 'block',
    errors,
    externalRootPath: inspection?.externalRootPath ?? '',
    ignoredDirectoryCount: inspection?.ignoredDirectories.length ?? 0,
    legacyMarkerPaths: inspection?.legacyMarkerPaths ?? [],
    mutationSequence: input.mutationSequence,
    notePath: input.notePath,
    targetPath: inspection?.targetPath ?? '',
    uuid: null
  };
}

function collectTopologyErrors(inspection: SetupTargetInspection): string[] {
  const errors = [...inspection.errors];
  if (inspection.targetIgnored) {
    errors.push('The expected external folder is ignored by settings.');
  }
  if (inspection.ancestorMarkerPaths.length > 0) {
    errors.push(`An ancestor folder already contains marker evidence: ${inspection.ancestorMarkerPaths.join(', ')}`);
  }
  if (inspection.descendantMarkerPaths.length > 0) {
    errors.push(`A descendant folder already contains marker evidence: ${inspection.descendantMarkerPaths.join(', ')}`);
  }
  if (inspection.skippedDirectories.length > 0) {
    errors.push('The expected folder contains unreadable or skipped evidence.');
  }
  return errors;
}
