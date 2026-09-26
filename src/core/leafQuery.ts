import type { LeafTreeNode } from './leafTree.ts';

import {
  finishAuditSteps,
  sortAuditSteps
} from './auditSteps.ts';

export type LeafCategory = 'dependencies' | 'generated' | 'git';
export interface LeafGroup {
  folderPath: string;
  key: string;
  rows: LeafRow[];
}
export interface LeafNoteMatch {
  absolutePath: string;
  association?: 'exact' | 'exact+uuid' | 'name' | 'uuid';
  notePath: string;
  status: string;
}
export interface LeafQuery {
  category: 'all' | 'ordinary' | LeafCategory;
  depth: number;
  search: string;
  showGenerated: boolean;
}
export interface LeafQueryResult {
  groups: LeafGroup[];
  hiddenCount: number;
  rows: LeafRow[];
  total: number;
}
export interface LeafReportModel {
  caseSensitivePaths?: boolean;
  coverage?: import('./folderInspection.ts').ReportCoverage;
  externalRoot: string;
  finishedAt: string;
  mutationWarning: boolean;
  rootFolder?: LeafTreeNode;
  rows: LeafRow[];
  stale?: boolean;
  startedAt: string;
  templateExclusionSummary?: string;
  tree?: LeafTreeNode[];
  uncheckedCount: number;
  vaultRoot: string;
}
export interface LeafRow {
  categories: LeafCategory[];
  folderPath: string;
  notes: LeafNoteMatch[];
  relativePath: string;
  searchText: string;
  segments: string[];
}

const DEFAULT_DEPTH = 2;
export function maximumGroupDepth(model: LeafReportModel): number {
  return model.rows.reduce((maximum, row) => Math.max(maximum, row.segments.length), 1);
}
export const DEFAULT_LEAF_QUERY: LeafQuery = { category: 'all', depth: DEFAULT_DEPTH, search: '', showGenerated: false };
export const GROUP_PAGE_SIZE = 50;
export const LEAF_PAGE_SIZE = 100;

export function classifyLeafSegments(segments: readonly string[]): LeafCategory[] {
  const parts = new Set(segments.map((segment) => segment.toLowerCase()));
  const categories: LeafCategory[] = [];
  if (parts.has('.git')) {
    categories.push('git');
  }
  if (parts.has('node_modules')) {
    categories.push('dependencies');
  }
  if (['build', 'dist', '.cache', '__pycache__', '.venv'].some((name) => parts.has(name))) {
    categories.push('generated');
  }
  return categories;
}

export function* queryLeafSteps(model: LeafReportModel, query: LeafQuery): Generator<void, LeafQueryResult> {
  const rows: LeafRow[] = [];
  const byGroup = new Map<string, LeafRow[]>();
  let hiddenCount = 0;
  const search = query.search.trim().toLowerCase();
  const depth = Math.min(maximumGroupDepth(model), Math.max(1, Math.floor(query.depth) || 1));
  const folders = new Map<string, string>();
  for (const row of model.rows) {
    yield;
    if (!query.showGenerated && row.categories.length > 0) {
      hiddenCount++;
      continue;
    }
    if (query.category === 'ordinary' && row.categories.length > 0) {
      continue;
    }
    if (query.category !== 'all' && query.category !== 'ordinary' && !row.categories.includes(query.category)) {
      continue;
    }
    if (!row.searchText.includes(search)) {
      continue;
    }
    rows.push(row);
    const count = Math.min(depth, row.segments.length);
    const key = row.segments.slice(0, count).join('/');
    // Absolute paths were computed by the Node adapter; only remove known trailing components here.
    const suffixLength = row.segments.slice(count).reduce((length, segment) => length + segment.length + 1, 0);
    const folderPath = suffixLength ? row.folderPath.slice(0, -suffixLength) : row.folderPath;
    folders.set(key, folderPath);
    const group = byGroup.get(key) ?? [];
    group.push(row);
    byGroup.set(key, group);
  }
  const groups = yield* sortAuditSteps(
    [...byGroup].map(([key, groupedRows]) => ({ folderPath: folders.get(key) ?? '', key, rows: groupedRows })),
    (a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key)
  );
  return { groups, hiddenCount, rows, total: model.rows.length };
}

export function queryLeaves(model: LeafReportModel, query: LeafQuery): LeafQueryResult {
  return finishAuditSteps(queryLeafSteps(model, query));
}
