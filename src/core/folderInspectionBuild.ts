// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation under ADR-0016.
import path from 'node:path';

import type {
  AuditIssue,
  AuditSnapshot
} from './auditTypes.ts';
import type {
  CoverageIssue,
  ReportCoverage
} from './folderInspection.ts';
import type { LeafTreeNode } from './leafTree.ts';

import { sortAuditSteps } from './auditSteps.ts';
import { normalizePathForIdentity as identity } from './pathPolicy.ts';

export function auditIssueScope(scan: AuditSnapshot, issue: AuditIssue): 'external' | 'vault' {
  const location = identity(issue.location);
  const vault = identity(scan.vaultRoot);
  return issue.scope ?? (location === vault || location.startsWith(vault + path.sep) ? 'vault' : 'external');
}

export function* folderInspectionSteps(scan: AuditSnapshot, tree: LeafTreeNode[], root: LeafTreeNode | undefined): Generator<void, ReportCoverage> {
  const nodes = new Map(tree.map((node) => [node.id, node]));
  for (const node of tree) {
    node.inspection = {
      ancestorMarkerId: null,
      directoryChecked: !node.unchecked && node.kind === 'directory',
      issueIds: [],
      markers: [],
      subtreeIssues: 0,
      subtreeMarkers: 0
    };
    yield;
  }
  for (const marker of scan.markers) {
    nodes.get(identity(marker.folderPath))?.inspection?.markers.push(marker);
    yield;
  }
  const coverage = yield* attachIssues(scan, nodes);
  const ordered = yield* sortAuditSteps(tree, (a, b) => a.segments.length - b.segments.length);
  yield* linkInspections(ordered, nodes, root);
  yield* aggregateInspections(ordered, nodes, root);
  return coverage;
}

function* aggregateInspections(ordered: LeafTreeNode[], nodes: Map<string, LeafTreeNode>, root: LeafTreeNode | undefined): Generator<void, void> {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i];
    const parent = node === root ? undefined : nodes.get(node?.parent ?? root?.id ?? '');
    if (parent?.inspection && node?.inspection) {
      parent.inspection.subtreeIssues += node.inspection.subtreeIssues;
      parent.inspection.subtreeMarkers += node.inspection.subtreeMarkers;
    }
    if (node?.inspection) {
      node.blocked ||= node.inspection.subtreeIssues > 0;
    }
    yield;
  }
}

function* attachIssues(scan: AuditSnapshot, nodes: Map<string, LeafTreeNode>): Generator<void, ReportCoverage> {
  const excluded = new Set(scan.external.ignoredDirectories.map((entry) => identity(entry.folderPath)));
  const issues: CoverageIssue[] = [];
  const vaultIdentityIssueIds: string[] = [];
  let vaultPathsComplete = true;
  for (const issue of scan.issues) {
    const scope = auditIssueScope(scan, issue);
    const kind = excluded.has(identity(issue.location)) ? 'excluded' : (issue.kind ?? 'directory');
    const id = `${scope}:${kind}:${issue.location}:${issue.reason}`;
    issues.push({ ...issue, id, kind, scope });
    if (scope === 'vault') {
      if (issue.unchecked) {
        vaultIdentityIssueIds.push(id);
        vaultPathsComplete &&= kind === 'note';
      }
    } else {
      const folder = kind === 'marker' ? path.dirname(issue.location) : issue.location;
      nodes.get(identity(folder))?.inspection?.issueIds.push(id);
    }
    yield;
  }
  return { issues, vaultIdentityIssueIds, vaultPathsComplete };
}

function* linkInspections(ordered: LeafTreeNode[], nodes: Map<string, LeafTreeNode>, root: LeafTreeNode | undefined): Generator<void, void> {
  for (const node of ordered) {
    const inspection = node.inspection;
    const parent = node === root ? undefined : nodes.get(node.parent ?? root?.id ?? '');
    if (inspection) {
      inspection.ancestorMarkerId = parent?.markers.length ? parent.id : (parent?.inspection?.ancestorMarkerId ?? null);
      inspection.subtreeIssues = inspection.issueIds.length;
      inspection.subtreeMarkers = inspection.markers.length;
    }
    yield;
  }
}
