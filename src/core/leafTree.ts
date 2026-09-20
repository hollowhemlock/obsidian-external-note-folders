import type {
  LeafReportModel,
  LeafRow
} from './leafQuery.ts';

import {
  finishAuditSteps,
  sortAuditSteps
} from './auditSteps.ts';
import { classifyLeafSegments } from './leafQuery.ts';

export interface LeafTreeNode extends LeafRow {
  blocked: boolean;
  children: string[];
  conflict: boolean;
  covered: boolean;
  descendantIssues: number;
  evidence?: import('./folderStatusTypes.ts').FolderEvidence;
  id: string;
  inspection?: import('./folderInspection.ts').FolderInspection;
  issues: string[];
  kind: 'directory' | 'excluded' | 'link' | 'virtual';
  markers: string[];
  parent: null | string;
  total: number;
  unchecked: boolean;
}
export interface TreeQuery {
  category: 'all' | 'ordinary' | LeafRow['categories'][number];
  includeExpected?: boolean;
  mode: 'all' | 'results';
  search: string;
  showGenerated: boolean;
  sort: 'count' | 'name';
  status?: string;
}
export interface TreeResult {
  children: Map<null | string, string[]>;
  counts: Map<string, number>;
  hiddenCount: number;
  matched: Set<string>;
  nodes: Map<string, LeafTreeNode>;
  rows: LeafRow[];
  visible: Set<string>;
}
export const DEFAULT_TREE_QUERY: TreeQuery = { category: 'all', mode: 'all', search: '', showGenerated: true, sort: 'name' };
export const TREE_PAGE_SIZE = 100;
const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function availableTreeStatuses(tree: readonly LeafTreeNode[]): string[] {
  return [...new Set(tree.map((node) => node.evidence?.status ?? 'Unchecked'))].sort();
}
/** Inspect physical descendants even when display filters hide their branches. */
export function* descendantIssueSteps(result: TreeResult, id: string): Generator<void, LeafTreeNode[]> {
  const nodes: LeafTreeNode[] = [];
  const pending = [...(result.nodes.get(id)?.children ?? [])];
  while (pending.length) {
    const current = pending.pop();
    const node = current === undefined ? undefined : result.nodes.get(current);
    if (node) {
      if (node.issues.length || node.conflict) {
        nodes.push(node);
      }
      for (const child of node.children) {
        pending.push(child);
        yield;
      }
    }
    yield;
  }
  return nodes;
}
/** Compatibility for callers supplying the earlier leaf-only model. */
export function* leafOnlyTreeSteps(model: LeafReportModel): Generator<void, LeafTreeNode[]> {
  const nodes = new Map<string, LeafTreeNode>();
  for (const row of model.rows) {
    for (let depth = 1; depth <= row.segments.length; depth++) {
      const segments = row.segments.slice(0, depth);
      const id = segments.join('/');
      if (!nodes.has(id)) {
        const suffix = row.segments.slice(depth).reduce((n, part) => n + part.length + 1, 0);
        const folderPath = suffix ? row.folderPath.slice(0, -suffix) : row.folderPath;
        nodes.set(id, {
          ...row,
          blocked: false,
          categories: classifyLeafSegments(segments),
          children: [],
          conflict: false,
          covered: false,
          descendantIssues: 0,
          folderPath,
          id,
          issues: [],
          kind: 'directory',
          markers: [],
          notes: depth === row.segments.length ? row.notes : [],
          parent: depth === 1 ? null : segments.slice(0, -1).join('/'),
          relativePath: id,
          searchText: id.toLowerCase(),
          segments,
          total: 0,
          unchecked: false
        });
      }
      const node = nodes.get(id);
      if (node) {
        node.total++;
      }
      yield;
    }
  }
  for (const node of nodes.values()) {
    if (node.parent !== null) {
      nodes.get(node.parent)?.children.push(node.id);
    }
    yield;
  }
  return [...nodes.values()];
}

export function queryTree(model: LeafReportModel, query: TreeQuery): TreeResult {
  return finishAuditSteps(queryTreeSteps(model, query));
}
export function* queryTreeSteps(model: LeafReportModel, query: TreeQuery): Generator<void, TreeResult> {
  const tree = model.tree ?? (yield* leafOnlyTreeSteps(model));
  const nodes = new Map<string, LeafTreeNode>();
  for (const node of tree) {
    nodes.set(node.id, node);
    yield;
  }
  const ordered = yield* sortAuditSteps(tree, (a, b) => a.segments.length - b.segments.length);
  const search = query.search.trim().replaceAll('\\', '/').toLowerCase();
  const matches = new Set<string>();
  const matchedNodes = new Set<string>();
  const visible = new Set<string>();
  const counts = new Map<string, number>();
  const rows: LeafRow[] = [];
  const leafPaths = new Map<string, LeafRow>();
  for (const row of model.rows) {
    leafPaths.set(row.folderPath, row);
    yield;
  }
  let hiddenCount = 0;
  for (const node of ordered) {
    const matched = matchesSearch(node, search, matches);
    if (matched) {
      matches.add(node.id);
    }
    const generated = node.categories.length > 0;
    const allowed = allowedNode(node, query);
    const leaf = leafPaths.get(node.folderPath);
    if (leaf && generated && !query.showGenerated) {
      hiddenCount++;
    }
    if (matched && allowed) {
      if (leaf) {
        rows.push(leaf);
        counts.set(node.id, 1);
      }
      if (node.evidence?.physicalLeaf && query.mode === 'all') {
        counts.set(node.id, 1);
      }
      if (leaf || query.mode === 'all') {
        matchedNodes.add(node.id);
        visible.add(node.id);
      }
    }
    yield;
  }
  yield* aggregateMatches(ordered, visible, counts);
  const sorted = yield* sortAuditSteps(tree, (a, b) =>
    (query.sort === 'count' ? b.total - a.total : 0)
    || names.compare(a.segments.at(-1) ?? '', b.segments.at(-1) ?? '') || compareIdentity(a.id, b.id));
  const children = new Map<null | string, string[]>();
  for (const node of sorted) {
    if (visible.has(node.id)) {
      const siblings = children.get(node.parent) ?? [];
      siblings.push(node.id);
      children.set(node.parent, siblings);
    }
    yield;
  }
  return { children, counts, hiddenCount, matched: matchedNodes, nodes, rows, visible };
}
export function retainAvailableTreeStatus(status: string | undefined, available: readonly string[]): string {
  return status && available.includes(status) ? status : '';
}
function* aggregateMatches(ordered: LeafTreeNode[], visible: Set<string>, counts: Map<string, number>): Generator<void, void> {
  for (let index = ordered.length - 1; index >= 0; index--) {
    const node = ordered[index];
    if (node && node.parent !== null) {
      if (visible.has(node.id)) {
        visible.add(node.parent);
      }
      counts.set(node.parent, (counts.get(node.parent) ?? 0) + (counts.get(node.id) ?? 0));
    }
    yield;
  }
}
function allowedNode(node: LeafTreeNode, query: TreeQuery): boolean {
  return matchesCategory(node, query) && (node.kind !== 'virtual' || query.includeExpected === true)
    && (!query.status || node.evidence?.status === query.status);
}
function compareIdentity(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function matchesCategory(node: LeafTreeNode, query: TreeQuery): boolean {
  const generated = node.categories.length > 0;
  return (query.showGenerated || !generated) && (query.category === 'all'
    || (query.category === 'ordinary' ? !generated : node.categories.includes(query.category)));
}

function matchesSearch(node: LeafTreeNode, search: string, matches: Set<string>): boolean {
  return !search || node.searchText.replaceAll('\\', '/').includes(search)
    || node.notes.some((note) => note.notePath.toLowerCase().includes(search))
    || (node.parent !== null && matches.has(node.parent));
}
