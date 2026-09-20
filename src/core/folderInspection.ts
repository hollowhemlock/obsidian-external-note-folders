import type { AuditMarker } from './auditTypes.ts';
import type { LeafReportModel } from './leafQuery.ts';
import type { LeafTreeNode } from './leafTree.ts';

export interface AdoptionBlocker {
  location: string;
  message: string;
  nodeId?: string;
}
export interface CoverageIssue {
  id: string;
  kind: 'directory' | 'excluded' | 'link' | 'marker' | 'note';
  location: string;
  reason: string;
  scope: 'external' | 'vault';
  unchecked: boolean;
}
export interface FolderInspection {
  ancestorMarkerId: null | string;
  directoryChecked: boolean;
  issueIds: string[];
  markers: AuditMarker[];
  subtreeIssues: number;
  subtreeMarkers: number;
}
export interface InspectionIndex {
  issues: Map<string, CoverageIssue>;
  nodes: Map<string, LeafTreeNode>;
  rootId: string | undefined;
  vaultIssueIds: string[];
}
export interface ReportCoverage {
  issues: CoverageIssue[];
  vaultIdentityIssueIds: string[];
  vaultPathsComplete: boolean;
}

export function* adoptionBlockerSteps(index: InspectionIndex, node: LeafTreeNode): Generator<void, AdoptionBlocker[]> {
  const blockers: AdoptionBlocker[] = [];
  for (const id of index.vaultIssueIds) {
    const issue = index.issues.get(id);
    if (issue) {
      blockers.push({ location: issue.location, message: `Cannot verify note identities: ${issue.reason}` });
    }
    yield;
  }
  for (const ancestor of markedAncestors(index, node)) {
    blockers.push({
      location: ancestor.folderPath,
      message: 'Cannot adopt separately: this ancestor contains a marker. Nested external note folders are not supported.',
      nodeId: ancestor.id
    });
    yield;
  }
  // Uninspected ancestors can hide marker evidence, even if a descendant was inventoried.
  let parent = index.nodes.get(node.parent ?? index.rootId ?? '');
  while (parent && parent.id !== node.id) {
    addIssues(parent);
    parent = parent.id === index.rootId ? undefined : index.nodes.get(parent.parent ?? index.rootId ?? '');
    yield;
  }
  const pending = [node];
  while (pending.length) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (current.markers.length) {
      blockers.push({
        location: current.folderPath,
        message: current.id === node.id
          ? 'This folder already contains a marker. Inspect its existing binding before adoption.'
          : 'Cannot adopt this parent: this descendant contains a marker. Adoption would create a nested binding.',
        nodeId: current.id
      });
    }
    addIssues(current);
    for (const id of current.children) {
      const child = index.nodes.get(id);
      if (child && child.kind !== 'virtual') {
        pending.push(child);
      }
      yield;
    }
    yield;
  }
  return blockers;
  function addIssues(current: LeafTreeNode): void {
    for (const id of current.inspection?.issueIds ?? []) {
      const issue = index.issues.get(id);
      if (issue?.unchecked) {
        blockers.push({ location: issue.location, message: blockerExplanation(issue), nodeId: current.id });
      }
    }
  }
}

export function createInspectionIndex(model: LeafReportModel): InspectionIndex {
  const nodes = new Map((model.tree ?? []).map((node) => [node.id, node]));
  if (model.rootFolder) {
    nodes.set(model.rootFolder.id, model.rootFolder);
  }
  return {
    issues: new Map((model.coverage?.issues ?? []).map((issue) => [issue.id, issue])),
    nodes,
    rootId: model.rootFolder?.id,
    vaultIssueIds: model.coverage?.vaultIdentityIssueIds ?? []
  };
}

export function evidenceExplanation(node: LeafTreeNode, tag: 'exact' | 'marker' | 'yaml'): string {
  const state = node.evidence?.[tag] ?? 'unchecked';
  if (tag === 'exact') {
    if (state === 'present') {
      return 'A vault note maps to this folder’s expected path. See associated notes below.';
    }
    return state === 'unchecked'
      ? 'Could not rule out a matching note because part of the vault’s paths was not inspected. See scan details.'
      : 'No note maps to this folder’s path. This is normal for content subfolders.';
  }
  if (tag === 'marker') {
    const texts = {
      absent: 'This folder contains no .exnf marker. An ancestor marker, if present, is shown separately.',
      invalid: 'This folder contains malformed marker evidence. Inspect the marker details.',
      present: 'Contains .exnf marker. Marker presence alone does not establish a unique binding.',
      unchecked: node.markers.length
        ? 'Marker found, but its identity could not be read. See marker and scan details.'
        : 'Could not establish whether this folder contains a marker because its directory was not fully inspected.'
    };
    return texts[state];
  }
  const texts = {
    absent: node.notes.length ? 'YAML exnf not found in associated notes.' : 'No associated note; no note identity to inspect.',
    invalid: 'An associated note has an invalid exnf property.',
    present: 'An associated note has a valid exnf UUID. It must match the marker UUID to establish a binding.',
    unchecked: 'An associated note’s exnf identity could not be checked. Its file path remains usable.'
  };
  return texts[state];
}

export function* markedAncestors(index: InspectionIndex, node: LeafTreeNode): Generator<LeafTreeNode, void> {
  let ancestor = index.nodes.get(node.inspection?.ancestorMarkerId ?? '');
  while (ancestor) {
    yield ancestor;
    ancestor = index.nodes.get(ancestor.inspection?.ancestorMarkerId ?? '');
  }
}

export function shortFolderStatus(node: LeafTreeNode): string {
  const status = node.evidence?.status ?? 'Unchecked';
  if (status.startsWith('Bound at ') && node.evidence?.confidence === 'provisional') {
    return 'Binding match · provisional';
  }
  const labels: Record<string, string> = {
    'Ambiguous or invalid evidence': 'Ambiguous / invalid',
    'Bound at different path': 'Bound · different path',
    'Bound at expected path': 'Already bound',
    'Inside a marked folder': 'Content subfolder',
    'Possible adoption candidate': 'Possible adoption'
  };
  return labels[status] ?? status;
}

function blockerExplanation(issue: CoverageIssue): string {
  const messages = {
    directory: 'Cannot verify adoption safety: this location could not be fully read.',
    excluded: 'Cannot verify adoption safety: this branch was excluded from the scan.',
    link: 'Cannot verify adoption safety: this symbolic link or junction was not followed.',
    marker: 'Cannot verify adoption safety: this marker’s identity could not be checked.',
    note: 'Cannot verify adoption safety: this note’s identity could not be checked.'
  };
  return `${messages[issue.kind]} ${issue.reason}`;
}
