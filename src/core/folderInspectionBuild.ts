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

import { isIntentionalExclusion } from './adoptionPolicy.ts';
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
  yield* linkInspections(ordered, nodes, root, coverage);
  yield* aggregateInspections(ordered, nodes, root);
  return coverage;
}

function* aggregateInspections(ordered: LeafTreeNode[], nodes: Map<string, LeafTreeNode>, root: LeafTreeNode | undefined): Generator<void, void> {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i];
    const parent = node === root ? undefined : nodes.get(node?.parent ?? root?.id ?? '');
    if (parent?.inspection && node?.inspection) {
      parent.inspection.subtreeIssues += node.inspection.subtreeIssues;
      parent.inspection.subtreeOmissions = (parent.inspection.subtreeOmissions ?? 0) + (node.inspection.subtreeOmissions ?? 0);
      parent.inspection.subtreeReservations = (parent.inspection.subtreeReservations ?? 0) + (node.inspection.subtreeReservations ?? 0);
      parent.inspection.subtreeMarkers += node.inspection.subtreeMarkers;
    }
    if (node?.inspection) {
      node.blocked = hasAdoptionBlocker(node);
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

function hasAdoptionBlocker(node: LeafTreeNode): boolean {
  const inspection = node.inspection;
  return node.covered || node.unchecked || node.kind === 'link' || !inspection || inspection.subtreeMarkers > 0
    || !!inspection.ancestorReserved || !!inspection.subtreeReservations
    || inspection.subtreeIssues > (inspection.subtreeOmissions ?? 0);
}

function* linkInspections(
  ordered: LeafTreeNode[],
  nodes: Map<string, LeafTreeNode>,
  root: LeafTreeNode | undefined,
  coverage: ReportCoverage
): Generator<void, void> {
  const omissions = new Set(coverage.issues.filter(isIntentionalExclusion).map((issue) => issue.id));
  for (const node of ordered) {
    const inspection = node.inspection;
    const parent = node === root ? undefined : nodes.get(node.parent ?? root?.id ?? '');
    if (inspection) {
      inspection.ancestorMarkerId = parent?.markers.length ? parent.id : (parent?.inspection?.ancestorMarkerId ?? null);
      inspection.subtreeIssues = inspection.issueIds.length;
      inspection.subtreeOmissions = inspection.issueIds.filter((id) => omissions.has(id)).length;
      inspection.subtreeReservations = Number(reservesTarget(node));
      inspection.ancestorReserved = !!parent && (!!parent.inspection?.ancestorReserved || reservesTarget(parent));
      inspection.subtreeMarkers = inspection.markers.length;
    }
    yield;
  }
}

function reservesTarget(node: LeafTreeNode): boolean {
  return node.notes.some((note) => (note.association === 'exact' || note.association === 'exact+uuid') && note.status !== 'missing-property');
}
