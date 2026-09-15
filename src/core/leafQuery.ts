import {
  finishAuditSteps,
  sortAuditSteps
} from './auditSteps.ts';

export type LeafCategory = 'dependencies' | 'generated' | 'git';
export interface LeafGroup {
  key: string;
  rows: LeafRow[];
}
export interface LeafNoteMatch {
  absolutePath: string;
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
  externalRoot: string;
  finishedAt: string;
  mutationWarning: boolean;
  rows: LeafRow[];
  startedAt: string;
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
// eslint-disable-next-line no-magic-numbers -- Supported grouping depths are a user-facing enumeration.
export const GROUP_DEPTHS = [1, 2, 3, 4] as const;
const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 4;
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
  const depth = Math.min(MAX_DEPTH, Math.max(1, query.depth));
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
    const key = row.segments.slice(0, Math.min(depth, row.segments.length - 1)).join('/') || '(root)';
    const group = byGroup.get(key) ?? [];
    group.push(row);
    byGroup.set(key, group);
  }
  const groups = yield* sortAuditSteps(
    [...byGroup].map(([key, groupedRows]) => ({ key, rows: groupedRows })),
    (a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key)
  );
  return { groups, hiddenCount, rows, total: model.rows.length };
}

export function queryLeaves(model: LeafReportModel, query: LeafQuery): LeafQueryResult {
  return finishAuditSteps(queryLeafSteps(model, query));
}
