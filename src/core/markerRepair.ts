import type { ExnfFrontmatterValue } from './frontmatter.ts';
import type { SetupTargetInspection } from './setupPlan.ts';

import { pathsOverlap } from './groupAdoption.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity as identity
} from './pathPolicy.ts';
import { isCanonicalUuid } from './uuid.ts';

export interface MarkerRepairContext {
  externalRootPath: string;
  ignorePatterns: string[];
  knownFolders: string[];
  notePath: string;
  targetPath: string;
  templatePatterns: string[];
  uuid: string;
}
export interface MarkerRepairNote {
  identity: ExnfFrontmatterValue;
  notePath: string;
}
export interface MarkerRepairOmission {
  location: string;
  reason: string;
}
export interface MarkerRepairPlan {
  action: 'create-missing-marker';
  errors: string[];
  externalRootPath: string;
  knownMatches: string[];
  markerPresent: boolean;
  mutationSequence: number;
  notePath: string;
  omissions: MarkerRepairOmission[];
  repairContext: MarkerRepairContext;
  targetPath: string;
  uuid: string;
}
export function buildMarkerRepairPlan(input: {
  context: MarkerRepairContext;
  inspection: SetupTargetInspection;
  knownMatches: string[];
  mutationSequence: number;
  notes: readonly MarkerRepairNote[];
}): MarkerRepairPlan {
  const { context, inspection, notes } = input;
  const errors = [...inspection.errors];
  const selected = notes.find((note) => note.notePath === context.notePath);
  if (selected?.identity.kind !== 'valid' || selected.identity.uuid !== context.uuid) {
    errors.push('The note identity changed or could not be read.');
  }
  if (identity(deriveExternalFolderPath(context.notePath, context.externalRootPath)) !== identity(context.targetPath)) {
    errors.push('The note no longer maps to this folder.');
  }
  if (inspection.targetKind !== 'directory' || inspection.targetIgnored) {
    errors.push('The target must be an existing, included directory.');
  }
  if (inspection.ancestorMarkerPaths.length || inspection.descendantMarkerPaths.length) {
    errors.push('Ancestor or descendant marker evidence prevents marker creation.');
  }
  if (inspection.skippedDirectories.length) {
    errors.push(`Required directories could not be checked: ${inspection.skippedDirectories.join(', ')}`);
  }
  if (inspection.targetMarkerUuids.some((uuid) => uuid !== context.uuid)) {
    errors.push('This folder contains another marker identity.');
  }
  checkOwnership(context, notes, errors);
  for (const folder of input.knownMatches) {
    errors.push(`This UUID is already present elsewhere: ${folder}`);
  }
  return {
    action: 'create-missing-marker',
    errors,
    externalRootPath: context.externalRootPath,
    knownMatches: input.knownMatches,
    markerPresent: inspection.targetMarkerUuids.includes(context.uuid),
    mutationSequence: input.mutationSequence,
    notePath: context.notePath,
    omissions: inspection.omissions ?? [],
    repairContext: context,
    targetPath: context.targetPath,
    uuid: context.uuid
  };
}
/** Persisted repair inputs are checked before any filesystem operation. */
export function isMarkerRepairContext(value: unknown): value is MarkerRepairContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<MarkerRepairContext>;
  return ['externalRootPath', 'targetPath', 'notePath'].every((key) => typeof item[key as keyof MarkerRepairContext] === 'string')
    && typeof item.uuid === 'string' && isCanonicalUuid(item.uuid)
    && [item.ignorePatterns, item.templatePatterns, item.knownFolders].every((list) =>
      Array.isArray(list) && list.every((entry: unknown) => typeof entry === 'string')
    );
}
export function isMarkerRepairOmissions(value: unknown): value is MarkerRepairOmission[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    !!item && typeof item === 'object'
    && 'location' in item && typeof item.location === 'string' && 'reason' in item && typeof item.reason === 'string'
  );
}
export function sameMarkerRepairScope(a: MarkerRepairPlan, b: MarkerRepairPlan): boolean {
  return JSON.stringify(a.repairContext) === JSON.stringify(b.repairContext) && JSON.stringify(a.omissions) === JSON.stringify(b.omissions);
}
function checkOwnership(context: MarkerRepairContext, notes: readonly MarkerRepairNote[], errors: string[]): void {
  for (const note of notes) {
    if (note.notePath === context.notePath) {
      continue;
    }
    if (note.identity.kind === 'valid' && note.identity.uuid === context.uuid) {
      errors.push(`UUID is already owned by ${note.notePath}.`);
    }
    let target: string;
    try {
      target = deriveExternalFolderPath(note.notePath, context.externalRootPath);
    } catch {
      continue;
    }
    if (identity(target) === identity(context.targetPath) || (note.identity.kind !== 'missing' && pathsOverlap(target, context.targetPath))) {
      errors.push(`Another note reserves this target: ${note.notePath}.`);
    }
  }
}
