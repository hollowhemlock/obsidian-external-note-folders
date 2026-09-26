import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { runAuditSteps } from '../auditScheduler.ts';
import { finishAuditSteps } from './auditSteps.ts';
import {
  buildLeafReport,
  buildLeafReportSteps
} from './leafReport.ts';
import {
  availableTreeStatuses,
  DEFAULT_TREE_QUERY,
  descendantIssueSteps,
  queryTree,
  queryTreeSteps,
  retainAvailableTreeStatus
} from './leafTree.ts';

function fixture(paths: string[]): ReturnType<typeof auditFixture> {
  const scan = auditFixture();
  scan.folders = paths.map((folder) => path.join(scan.externalRoot, folder));
  scan.notes = [];
  return scan;
}
describe('filesystem report tree', () => {
  it('filters adoptable physical leaves with the current search and availability', () => {
    const model = buildLeafReport(fixture(['Branch', 'Branch/Available', 'Branch/Blocked', 'Other']));
    const blocked = model.tree!.find((node) => node.segments.at(-1) === 'Blocked')!;
    blocked.blocked = true;
    const query = { ...DEFAULT_TREE_QUERY, adoptableOnly: true, search: 'Branch' };
    const result = queryTree(model, query);
    expect([...result.matched].map((id) => result.nodes.get(id)?.segments.at(-1))).toEqual(['Available']);
    expect(result.rows.map((row) => row.segments.at(-1))).toEqual(['Available']);
    expect([...result.visible].map((id) => result.nodes.get(id)?.segments.at(-1))).toContain('Branch');
    expect(queryTree(model, { ...query, category: 'git' }).matched.size).toBe(0);
    model.stale = true;
    expect(queryTree(model, query).matched.size).toBe(0);
  });

  it('counts adoptable leaves separately from all leaves and keeps whole-branch totals under filtering', () => {
    const model = buildLeafReport(fixture(['Branch', 'Branch/Available', 'Branch/Blocked', 'Elsewhere']));
    const branch = model.tree!.find((node) => node.relativePath === 'Branch')!;
    const blocked = model.tree!.find((node) => node.segments.at(-1) === 'Blocked')!;
    blocked.blocked = true;
    const result = queryTree(model, DEFAULT_TREE_QUERY);
    expect(result.adoptableCounts.get(branch.id)).toBe(1);
    expect(result.counts.get(branch.id)).toBe(2);
    const filtered = queryTree(model, { ...DEFAULT_TREE_QUERY, search: 'Available' });
    expect(filtered.filteredAdoptableCounts.get(branch.id)).toBe(1);
    expect(filtered.counts.get(branch.id)).toBe(1);
    expect(filtered.adoptableCounts.get(branch.id)).toBe(1);
    expect(branch.total).toBe(2);
    model.coverage!.vaultIdentityIssueIds.push('unreadable-note');
    const restricted = queryTree(model, DEFAULT_TREE_QUERY);
    expect(restricted.adoptableCounts.get(branch.id) ?? 0).toBe(0);
    expect(restricted.counts.get(branch.id)).toBe(2);
  });

  it('keeps natural sibling order and stable total-count order under filtering', () => {
    const model = buildLeafReport(fixture(['item10', 'item2', 'item2/a', 'item2/b']));
    const names = queryTree(model, DEFAULT_TREE_QUERY);
    expect(names.children.get(null)?.map((id) => names.nodes.get(id)?.relativePath)).toEqual(['item2', 'item10']);
    const counted = queryTree(model, { ...DEFAULT_TREE_QUERY, search: 'item2/a', sort: 'count' });
    const parent = model.tree?.find((node) => node.relativePath === 'item2');
    expect(parent?.total).toBe(2);
    expect(counted.counts.get(parent?.id ?? '')).toBe(1);
    expect(counted.rows.map((row) => row.relativePath)).toEqual([path.join('item2', 'a')]);
  });
  it('matches ancestor folder notes and deduplicates descendants and exports', async () => {
    const scan = fixture(['Project', 'Project/a', 'Project/b', 'Project/node_modules', 'Project/node_modules/pkg']);
    scan.notes = ['Project.md', 'Project/Project.md'].map((relativePath) => ({
      hasExnf: false,
      notePath: path.join(scan.vaultRoot, relativePath),
      relativePath,
      status: 'missing-property',
      uuid: '',
      value: ''
    }));
    const model = buildLeafReport(scan);
    expect(await runAuditSteps(buildLeafReportSteps(scan))).toEqual(model);
    const query = { ...DEFAULT_TREE_QUERY, search: 'PROJECT.MD', showGenerated: false };
    const result = queryTree(model, query);
    expect(result.rows).toHaveLength(2);
    expect(result.hiddenCount).toBe(1);
    expect(await runAuditSteps(queryTreeSteps(model, query))).toEqual(result);
    expect(queryTree(model, { ...query, mode: 'all', sort: 'count' }).rows).toEqual(result.rows);
    expect(queryTree(model, { ...query, showGenerated: true }).rows).toHaveLength(3);
    expect(model.tree?.find((node) => node.relativePath === 'Project')?.notes).toHaveLength(2);
  });
  it('keeps physical branches when filters hide every child', () => {
    const model = buildLeafReport(fixture(['Project', 'Project/node_modules', 'Project/node_modules/pkg']));
    const result = queryTree(model, { ...DEFAULT_TREE_QUERY, mode: 'all', showGenerated: false });
    const project = model.tree?.find((node) => node.relativePath === 'Project');
    expect(project?.children).toHaveLength(1);
    expect(result.visible.has(project?.id ?? '')).toBe(true);
    expect(result.children.get(project?.id ?? '')).toBeUndefined();
    expect(result.rows).toHaveLength(0);
  });
  it('resets a status filter that is unavailable after refresh', () => {
    const model = buildLeafReport(fixture(['ordinary']));
    const available = availableTreeStatuses(model.tree ?? []);
    const status = retainAvailableTreeStatus('Bound at different path', available);
    expect(status).toBe('');
    expect(queryTree(model, { ...DEFAULT_TREE_QUERY, status }).visible.size).toBe(1);
  });
  it('shows marked branches only in all mode and blocks overlapping adoption, not siblings', () => {
    const scan = fixture(['marked', 'marked/child', 'ordinary']);
    scan.markers.push({
      folderPath: scan.folders[0] ?? '',
      format: 'uuid-named',
      markerPath: path.join(scan.folders[0] ?? '', 'bad.EXNF'),
      status: 'invalid-marker',
      uuid: ''
    });
    // The physical scanner also records malformed marker evidence in the external scan.
    scan.external.malformedMarkers.push({ location: scan.markers[0]?.markerPath ?? '', message: 'bad marker' });
    const model = buildLeafReport(scan);
    expect(queryTree(model, DEFAULT_TREE_QUERY).rows.map((row) => row.relativePath)).toEqual(['ordinary']);
    const all = queryTree(model, { ...DEFAULT_TREE_QUERY, mode: 'all', showGenerated: false });
    expect(all.visible.size).toBe(3);
    expect(model.tree?.find((node) => node.relativePath === 'marked')?.conflict).toBe(true);
    expect(model.tree?.find((node) => node.relativePath === path.join('marked', 'child'))?.covered).toBe(true);
    expect(model.tree?.find((node) => node.relativePath === 'ordinary')?.blocked).toBe(false);
  });
  it('distinguishes link placeholders and marker issues from directories', () => {
    const scan = fixture(['Project', 'Project/a', 'Other']);
    scan.issues.push({ kind: 'link', location: path.join(scan.externalRoot, 'Project/link'), reason: 'Skipped link', scope: 'external', unchecked: true }, {
      kind: 'marker',
      location: path.join(scan.externalRoot, 'Other/.exnf'),
      reason: 'Unreadable marker',
      scope: 'external',
      unchecked: true
    });
    const model = buildLeafReport(scan);
    expect(model.tree?.find((node) => node.relativePath === path.join('Project', 'link'))?.kind).toBe('link');
    expect(model.tree?.some((node) => node.relativePath.endsWith('.exnf'))).toBe(false);
    expect(model.tree?.find((node) => node.relativePath === 'Project')?.blocked).toBe(true);
    const parent = model.tree?.find((node) => node.relativePath === 'Project');
    const filtered = queryTree(model, DEFAULT_TREE_QUERY);
    expect(finishAuditSteps(descendantIssueSteps(filtered, parent?.id ?? '')).map((node) => node.kind)).toEqual(['link']);

    expect(model.tree?.find((node) => node.relativePath === path.join('Project', 'a'))?.blocked).toBe(false);
    expect(model.tree?.find((node) => node.relativePath === 'Other')?.unchecked).toBe(false);
  });
  it('inherits root markers without making the root a selectable node', () => {
    const scan = fixture(['child']);
    scan.markers.push({
      folderPath: scan.externalRoot,
      format: 'legacy',
      markerPath: path.join(scan.externalRoot, '.exnf'),
      status: 'invalid-marker',
      uuid: ''
    });
    const model = buildLeafReport(scan);
    expect(model.tree).toHaveLength(1);
    expect(model.tree?.[0]?.covered).toBe(true);
    expect(queryTree(model, DEFAULT_TREE_QUERY).rows).toHaveLength(0);
  });
  it('supports cancellation and 20,000-leaf queries without changing export membership', async () => {
    const model = buildLeafReport(auditFixture(20000));
    const query = { ...DEFAULT_TREE_QUERY, mode: 'all' as const, search: 'folder', sort: 'count' as const };
    const result = await runAuditSteps(queryTreeSteps(model, query));
    expect(result.rows).toHaveLength(20000);
    expect(new Set(result.rows.map((row) => row.folderPath)).size).toBe(20000);
    const abort = new AbortController();
    abort.abort();
    await expect(runAuditSteps(queryTreeSteps(model, query), { signal: abort.signal })).rejects.toThrow();
  });
});
