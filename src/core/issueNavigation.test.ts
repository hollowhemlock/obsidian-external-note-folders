import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { finishAuditSteps } from './auditSteps.ts';
import {
  adjacentIssue,
  adoptableLeafOrderSteps,
  issueOrderSteps
} from './issueNavigation.ts';
import { buildLeafReport } from './leafReport.ts';
import {
  DEFAULT_TREE_QUERY,
  queryTree
} from './leafTree.ts';
import { revealTreePath } from './leafTreeNavigation.ts';

describe('review filter and issue navigation', () => {
  it('limits adoptable navigation to matching leaves even when another folder is temporarily revealed', () => {
    const model = buildLeafReport(auditFixture(3));
    const target = model.tree!.find((node) => node.relativePath === 'folder-1')!;
    const other = model.tree!.find((node) => node.relativePath === 'folder-2')!;
    const filtered = queryTree(model, { ...DEFAULT_TREE_QUERY, search: 'folder-1' });
    expect(finishAuditSteps(adoptableLeafOrderSteps(revealTreePath(filtered, other.id))).ids).toEqual([target.id]);
    expect(finishAuditSteps(adoptableLeafOrderSteps(queryTree(model, { ...DEFAULT_TREE_QUERY, needsReview: true }))).ids).toEqual([]);
    const changed = queryTree(model, DEFAULT_TREE_QUERY, new Map([[target.folderPath, null]]));
    expect(finishAuditSteps(adoptableLeafOrderSteps(changed)).ids).not.toContain(target.id);
  });

  it('navigates adoptable physical leaves past collapsed pages using the shared availability checks', () => {
    const model = buildLeafReport(auditFixture(150));
    const first = model.tree!.find((node) => node.relativePath === 'folder-0')!;
    first.blocked = true;
    const result = queryTree(model, DEFAULT_TREE_QUERY);
    const order = finishAuditSteps(adoptableLeafOrderSteps(result));
    expect(order.ids).toHaveLength(149);
    expect(order.ids).not.toContain(first.id);
    expect(adjacentIssue(order, order.ids.at(-1), 1)).toBeUndefined();
    expect(order.ids.some((id) => result.nodes.get(id)?.relativePath === 'folder-120')).toBe(true);
    model.stale = true;
    expect(finishAuditSteps(adoptableLeafOrderSteps(queryTree(model, DEFAULT_TREE_QUERY))).ids).toEqual([]);
  });

  it('visits matches beyond rendered pages and stops at either end', () => {
    const model = buildLeafReport(auditFixture(150));
    for (const n of model.tree!) {
      if (['folder-120', 'folder-2'].includes(n.relativePath)) {
        n.evidence!.status = 'Marker absent here';
      }
    }
    const result = queryTree(model, DEFAULT_TREE_QUERY);
    const order = finishAuditSteps(issueOrderSteps(result));
    expect(order.ids).toHaveLength(2);
    expect(adjacentIssue(order, undefined, 1)).toBe(order.ids[0]);
    expect(adjacentIssue(order, undefined, -1)).toBe(order.ids[1]);
    expect(adjacentIssue(order, order.ids[0], -1)).toBeUndefined();
    expect(adjacentIssue(order, order.ids[1], 1)).toBeUndefined();
    const middle = model.tree!.find((n) => n.relativePath === 'folder-50')!;
    expect(adjacentIssue(order, middle.id, 1)).toBe(order.ids[1]);
    expect(adjacentIssue(order, middle.id, -1)).toBe(order.ids[0]);
    const reviewOnly = queryTree(model, { ...DEFAULT_TREE_QUERY, needsReview: true });
    const filteredOrder = finishAuditSteps(issueOrderSteps(reviewOnly));
    expect(reviewOnly.visible.has(middle.id)).toBe(false);
    expect(adjacentIssue(filteredOrder, middle.id, 1)).toBe(order.ids[1]);
    expect(adjacentIssue(filteredOrder, middle.id, -1)).toBe(order.ids[0]);
  });
  it('intersects review with other filters and excludes temporary reveals', () => {
    const model = buildLeafReport(auditFixture(3));
    model.tree![0]!.evidence!.status = 'Marker absent here';
    model.tree![1]!.conflict = true;
    const result = queryTree(model, { ...DEFAULT_TREE_QUERY, needsReview: true });
    expect(result.matched.size).toBe(2);
    const filtered = queryTree(model, { ...DEFAULT_TREE_QUERY, needsReview: true, status: 'Marker absent here' });
    expect(filtered.matched.size).toBe(1);
    expect(queryTree(model, { ...DEFAULT_TREE_QUERY, needsReview: true, search: 'folder-2' }).matched.size).toBe(0);
    const revealed = revealTreePath(filtered, model.tree![1]!.id);
    expect(finishAuditSteps(issueOrderSteps(revealed)).ids).toEqual([model.tree![0]!.id]);
    expect(revealed.matched).toEqual(filtered.matched);
  });
});
