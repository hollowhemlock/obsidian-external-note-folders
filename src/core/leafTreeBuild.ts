// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation; not part of the browser query bundle.
import path from 'node:path';

import type { AuditSnapshot } from './auditTypes.ts';
import type {
  LeafNoteMatch,
  LeafRow
} from './leafQuery.ts';
import type { LeafTreeNode } from './leafTree.ts';

import { sortAuditSteps } from './auditSteps.ts';
import { classifyLeafSegments } from './leafQuery.ts';
import { normalizePathForIdentity } from './pathPolicy.ts';

export function* buildLeafTreeSteps(snapshot: AuditSnapshot, rows: LeafRow[], notes: Map<string, LeafNoteMatch[]>): Generator<void, LeafTreeNode[]> {
  const nodes = new Map<string, LeafTreeNode>();
  const rootId = normalizePathForIdentity(snapshot.externalRoot);
  function ensure(folderPath: string): LeafTreeNode {
    const id = normalizePathForIdentity(folderPath);
    const existing = nodes.get(id);
    if (existing) {
      return existing;
    }
    const relativePath = path.relative(snapshot.externalRoot, folderPath);
    const segments = relativePath ? relativePath.split(path.sep) : [];
    const matches = notes.get(id) ?? [];
    const node: LeafTreeNode = {
      blocked: false,
      categories: classifyLeafSegments(segments),
      children: [],
      conflict: matches.some((note) => ['duplicate-uuid', 'invalid-property'].includes(note.status)),
      covered: false,
      descendantIssues: 0,
      folderPath,
      id,
      issues: [],
      kind: 'directory',
      markers: [],
      notes: matches,
      parent: id === rootId ? null : normalizePathForIdentity(path.dirname(folderPath)),
      relativePath,
      searchText: [relativePath, ...matches.map((note) => note.notePath)].join('\n').toLowerCase(),
      segments,
      total: 0,
      unchecked: false
    };
    nodes.set(id, node);
    return node;
  }
  ensure(snapshot.externalRoot);
  for (const folder of snapshot.folders) {
    let current = folder;
    while (normalizePathForIdentity(current) !== rootId && !nodes.has(normalizePathForIdentity(current))) {
      ensure(current);
      current = path.dirname(current);
      yield;
    }
  }
  yield* attachEvidence(snapshot, nodes, ensure);
  for (const row of rows) {
    const node = nodes.get(normalizePathForIdentity(row.folderPath));
    if (node) {
      node.total = 1;
    }
    yield;
  }
  const ordered = yield* sortAuditSteps([...nodes.values()], (a, b) => a.segments.length - b.segments.length);
  yield* aggregateTree(ordered, nodes);
  const result: LeafTreeNode[] = [];
  for (const node of ordered) {
    if (node.id !== rootId) {
      if (node.parent === rootId) {
        node.parent = null;
      }
      result.push(node);
    }
    yield;
  }
  return result;
}
function* aggregateTree(ordered: LeafTreeNode[], nodes: Map<string, LeafTreeNode>): Generator<void, void> {
  for (const node of ordered) {
    const parent = node.parent === null ? undefined : nodes.get(node.parent);
    parent?.children.push(node.id);
    node.covered = !!parent && (parent.covered || parent.markers.length > 0);
    node.unchecked ||= parent?.unchecked ?? false;
    node.blocked = node.covered || node.markers.length > 0 || node.unchecked || node.kind === 'link';
    yield;
  }
  for (let index = ordered.length - 1; index >= 0; index--) {
    const node = ordered[index];
    const parent = node?.parent ? nodes.get(node.parent) : undefined;
    if (node && parent) {
      parent.total += node.total;
      parent.descendantIssues += node.descendantIssues + Number(node.issues.length > 0 || node.conflict);
      parent.blocked ||= node.blocked;
    }
    yield;
  }
}
function* attachEvidence(snapshot: AuditSnapshot, nodes: Map<string, LeafTreeNode>, ensure: (folder: string) => LeafTreeNode): Generator<void, void> {
  for (const marker of snapshot.markers) {
    const node = nodes.get(normalizePathForIdentity(marker.folderPath));
    if (node) {
      node.markers.push(`${marker.markerPath} — ${marker.status}`);
      node.conflict ||= marker.status === 'invalid-marker' || !!(marker.uuid && snapshot.external.duplicatePaths.has(marker.uuid)) || node.markers.length > 1;
    }
    yield;
  }
  for (const issue of snapshot.issues) {
    const relative = path.relative(snapshot.externalRoot, issue.location);
    if (issue.scope === 'vault' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue;
    }
    let node = nodes.get(normalizePathForIdentity(issue.location));
    if (issue.kind === 'link') {
      node = ensure(issue.location);
      node.kind = 'link';
    }
    node ??= nodes.get(normalizePathForIdentity(path.dirname(issue.location)));
    if (node) {
      node.issues.push(`${issue.location} — ${issue.reason}`);
      node.unchecked ||= issue.unchecked;
    }
    yield;
  }
}
