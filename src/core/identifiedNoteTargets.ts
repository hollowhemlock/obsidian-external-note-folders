import type { VaultScanResult } from './verify.ts';

import { normalizeDisplayPath } from './displayPath.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export interface IdentifiedNoteConflict {
  message: string;
  reason: 'ancestor-identified-note' | 'descendant-identified-note' | 'target-already-identified';
}

export interface IdentifiedNoteTarget {
  identity: string;
  message: string;
}

export function buildExistingIdentifiedNoteTargets(
  vaultScan: VaultScanResult,
  externalRootPath: string,
  excludedNotePath?: string
): IdentifiedNoteTarget[] {
  const uuidByNotePath = new Map<string, string>();
  for (const [uuid, notePath] of vaultScan.bindings) {
    uuidByNotePath.set(notePath, uuid);
  }
  for (const [uuid, notePaths] of vaultScan.duplicatePaths) {
    for (const notePath of notePaths) {
      uuidByNotePath.set(notePath, uuid);
    }
  }

  const targets: IdentifiedNoteTarget[] = [];
  for (const [notePath, uuid] of [...uuidByNotePath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (notePath === excludedNotePath) {
      continue;
    }
    try {
      targets.push({
        identity: normalizePathForIdentity(deriveExternalFolderPath(notePath, externalRootPath)),
        message: `note ${notePath} (${uuid})`
      });
    } catch {
      // Invalid identified note paths are reported by vault verification and cannot reserve a derived target.
    }
  }
  return targets;
}

export function findIdentifiedNoteConflict(
  identifiedNoteTargets: readonly IdentifiedNoteTarget[],
  targetIdentity: string
): IdentifiedNoteConflict | null {
  const exact = identifiedNoteTargets.find((target) => target.identity === targetIdentity);
  if (exact) {
    return { message: `Derived external folder path is already reserved by ${exact.message}.`, reason: 'target-already-identified' };
  }
  const ancestor = identifiedNoteTargets.find((target) => isDescendantIdentity(targetIdentity, target.identity));
  if (ancestor) {
    return { message: `Identified ancestor note reserves a folder containing this target: ${ancestor.message}`, reason: 'ancestor-identified-note' };
  }
  const descendant = identifiedNoteTargets.find((target) => isDescendantIdentity(target.identity, targetIdentity));
  return descendant
    ? { message: `Identified descendant note reserves a folder inside this target: ${descendant.message}`, reason: 'descendant-identified-note' }
    : null;
}

function isDescendantIdentity(childIdentity: string, parentIdentity: string): boolean {
  const parent = normalizeDisplayPath(parentIdentity);
  return normalizeDisplayPath(childIdentity).startsWith(parent.endsWith('/') ? parent : `${parent}/`);
}
