import type { FolderAttention } from './folderAttention.ts';
import type { LeafReportModel } from './leafQuery.ts';
import type { LeafTreeNode } from './leafTree.ts';

import { sortAuditSteps } from './auditSteps.ts';
import { folderAttention } from './folderAttention.ts';

export interface FolderAvailability {
  adoptable: boolean;
  attention: FolderAttention;
  operation?: FolderOperation;
}
export type FolderOperation = [string, null | string];

/** Linear tree passes reuse scan aggregates; detailed blocker walks are selection-only. */
export function* folderAvailabilitySteps(
  model: LeafReportModel,
  tree: readonly LeafTreeNode[],
  operations: ReadonlyMap<string, null | string> = new Map()
): Generator<void, Map<string, FolderAvailability>> {
  const all = model.rootFolder ? [model.rootFolder, ...tree] : tree;
  const changes = yield* operationIndexSteps(all, operations, model.rootFolder?.id ?? '', model.caseSensitivePaths ?? false);
  const result = new Map<string, FolderAvailability>();
  const blockedGlobally = !!model.stale || !!model.coverage?.vaultIdentityIssueIds.length;
  for (const node of all) {
    const operation = changes.get(node.id);
    const adoptable = !blockedGlobally && !operation && availableNode(node, model.rootFolder?.id);
    let change: 'changed' | 'pending' | undefined;
    if (operation) {
      change = operation[1] === null ? 'pending' : 'changed';
    }
    const tone = folderAttention(node, change);
    let attention = tone;
    if (tone === 'neutral' || tone === 'optional') {
      attention = adoptable ? 'optional' : 'neutral';
    }
    result.set(node.id, { adoptable, attention, ...(operation ? { operation } : {}) });
    yield;
  }
  return result;
}

export function isAdoptableLeaf(node: LeafTreeNode | undefined, availability: FolderAvailability | undefined): boolean {
  return node?.evidence?.physicalLeaf === true && availability?.adoptable === true;
}

/** Preserve captured evidence while disclosing session-dependent export membership. */
export function statusExportNode(node: LeafTreeNode, availability: FolderAvailability | undefined, stale: boolean): LeafTreeNode {
  if (!node.evidence || (!stale && !availability?.operation)) {
    return node;
  }
  const operation = availability?.operation;
  const explanation = operation
    ? `Session context: ${operation[1] === null ? 'pending recovery' : 'binding changed'} at ${
      operation[0]
    }. Status fields describe the captured scan; refresh for current evidence.`
    : 'Session context: snapshot predates mutations. Adoption availability is disabled until refresh; status fields describe the captured scan.';
  return { ...node, evidence: { ...node.evidence, explanations: [...node.evidence.explanations, explanation] } };
}

function availableNode(node: LeafTreeNode, rootId: string | undefined): boolean {
  return node.id !== rootId && node.kind === 'directory' && !!node.inspection?.directoryChecked
    && !node.blocked && !node.conflict && !node.covered && !node.markers.length
    && !node.inspection.subtreeIssues && !node.inspection.subtreeMarkers;
}
function key(folder: string, caseSensitive: boolean): string {
  const normalized = folder.normalize('NFC').replaceAll('\\', '/').replace(/\/$/u, '');
  return caseSensitive ? normalized : normalized.toLowerCase();
}
function mergeOperation(map: Map<string, FolderOperation>, id: string, operation: FolderOperation | undefined): void {
  const value = strongest(map.get(id), operation);
  if (value) {
    map.set(id, value);
  }
}

function* operationIndexSteps(
  all: readonly LeafTreeNode[],
  operations: ReadonlyMap<string, null | string>,
  rootId: string,
  caseSensitive: boolean
): Generator<void, Map<string, FolderOperation>> {
  const paths = new Map<string, string>();
  for (const node of all) {
    paths.set(key(node.folderPath, caseSensitive), node.id);
    yield;
  }
  const direct = new Map<string, FolderOperation>();
  const nested = new Map<string, FolderOperation>();
  for (const operation of operations) {
    let location = key(operation[0], caseSensitive);
    const exact = paths.get(location);
    if (exact) {
      mergeOperation(direct, exact, operation);
    } else {
      // Moved/removed folders still affect the nearest captured ancestor.
      while (location.includes('/')) {
        location = location.slice(0, location.lastIndexOf('/'));
        const parent = paths.get(location);
        if (parent) {
          mergeOperation(nested, parent, operation);
          break;
        }
        yield;
      }
    }
    yield;
  }
  const ordered = yield* sortAuditSteps(all, (a, b) => a.segments.length - b.segments.length);
  return yield* propagateOperations(ordered, direct, nested, rootId);
}

function* propagateOperations(
  ordered: readonly LeafTreeNode[],
  direct: Map<string, FolderOperation>,
  nested: Map<string, FolderOperation>,
  rootId: string
): Generator<void, Map<string, FolderOperation>> {
  const inherited = new Map<string, FolderOperation>();
  for (const node of ordered) {
    const parentId = node.id === rootId ? '' : node.parent ?? rootId;
    mergeOperation(inherited, node.id, strongest(inherited.get(parentId), direct.get(node.id)));
    yield;
  }
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i];
    if (!node) {
      continue;
    }
    const parentId = node.id === rootId ? '' : node.parent ?? rootId;
    const operation = strongest(nested.get(node.id), direct.get(node.id));
    mergeOperation(nested, node.id, operation);
    mergeOperation(nested, parentId, operation);
    yield;
  }
  for (const node of ordered) {
    mergeOperation(inherited, node.id, nested.get(node.id));
    yield;
  }
  return inherited;
}

/** Pending recovery always wins, even when an earlier overlapping change completed. */
function strongest(a: FolderOperation | undefined, b: FolderOperation | undefined): FolderOperation | undefined {
  if (!a || b?.[1] === null) {
    return b ?? a;
  }
  return a;
}
