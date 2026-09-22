import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { finishAuditSteps } from './auditSteps.ts';
import {
  folderAvailabilitySteps,
  statusExportNode
} from './folderAvailability.ts';
import { buildLeafReport } from './leafReport.ts';

function fixture(): {
  a: import('./leafTree.ts').LeafTreeNode;
  b: import('./leafTree.ts').LeafTreeNode;
  model: ReturnType<typeof buildLeafReport>;
  parent: import('./leafTree.ts').LeafTreeNode;
} {
  const scan = auditFixture();
  scan.folders.push(...['Parent', 'Parent/A', 'Parent/B', 'Other'].map((p) => path.join(scan.externalRoot, p)));
  const model = buildLeafReport(scan);
  const parent = model.tree!.find((n) => n.relativePath === 'Parent')!;
  const a = model.tree!.find((n) => n.segments.at(-1) === 'A')!;
  const b = model.tree!.find((n) => n.segments.at(-1) === 'B')!;
  return { a, b, model, parent };
}
describe('shared folder availability', () => {
  it('keeps case-distinct folders separate with captured case-sensitive identities', () => {
    const { a, model } = fixture();
    model.caseSensitivePaths = true;
    const upper = { ...a, folderPath: '/external/Foo', id: '/external/Foo', parent: null, segments: ['Foo'] };
    const lower = { ...a, folderPath: '/external/foo', id: '/external/foo', parent: null, segments: ['foo'] };
    const tree = [upper, lower];
    for (const folder of ['/external/Foo', '/external/Foo/removed']) {
      const index = finishAuditSteps(folderAvailabilitySteps(model, tree, new Map([[folder, null]])));
      expect(index.get(upper.id)?.operation).toEqual([folder, null]);
      expect(index.get(lower.id)?.operation).toBeUndefined();
    }
  });
  it('still matches case variants on case-insensitive roots', () => {
    const { a, model } = fixture();
    model.caseSensitivePaths = false;
    const index = finishAuditSteps(folderAvailabilitySteps(model, model.tree!, new Map([[a.folderPath.toUpperCase(), null]])));
    expect(index.get(a.id)?.attention).toBe('conflict');
  });
  it('offers branches and leaves without requiring note matches, excluding the root', () => {
    const { a, model, parent } = fixture();
    const index = finishAuditSteps(folderAvailabilitySteps(model, model.tree!));
    expect(index.get(parent.id)).toEqual({ adoptable: true, attention: 'optional' });
    expect(index.get(a.id)).toEqual({ adoptable: true, attention: 'optional' });
    expect(index.get(model.rootFolder!.id)?.adoptable).toBe(false);
  });
  it.each(['blocked', 'covered', 'conflict'] as const)('does not offer folders flagged %s', (flag) => {
    const { model, parent } = fixture();
    parent[flag] = true;
    const value = finishAuditSteps(folderAvailabilitySteps(model, model.tree!)).get(parent.id)!;
    expect(value.adoptable).toBe(false);
    expect(value.attention).toBe(flag === 'conflict' ? 'conflict' : 'neutral');
  });
  it.each(['excluded', 'link', 'virtual'] as const)('does not offer %s entries', (kind) => {
    const { model, parent } = fixture();
    parent.kind = kind;
    expect(finishAuditSteps(folderAvailabilitySteps(model, model.tree!)).get(parent.id)?.adoptable).toBe(false);
  });
  it.each(['subtreeIssues', 'subtreeMarkers'] as const)('uses captured %s aggregates', (field) => {
    const { model, parent } = fixture();
    parent.inspection![field] = 1;
    expect(finishAuditSteps(folderAvailabilitySteps(model, model.tree!)).get(parent.id)?.adoptable).toBe(false);
  });
  it('keeps missing-marker evidence amber even with a bound descendant', () => {
    const { model, parent } = fixture();
    parent.blocked = true;
    parent.evidence!.status = 'Marker absent here';
    expect(finishAuditSteps(folderAvailabilitySteps(model, model.tree!)).get(parent.id)).toEqual({ adoptable: false, attention: 'review' });
  });
  it.each([false, true])('gives pending siblings priority regardless of insertion order (reverse=%s)', (reverse) => {
    const { a, b, model, parent } = fixture();
    model.stale = true;
    const entries: [string, null | string][] = [[a.folderPath, 'A.md'], [b.folderPath, null]];
    const operations = new Map(reverse ? entries.reverse() : entries);
    const index = finishAuditSteps(folderAvailabilitySteps(model, model.tree!, operations));
    expect(index.get(parent.id)?.attention).toBe('conflict');
    expect(index.get(parent.id)?.operation).toEqual([b.folderPath, null]);
    expect(index.get(a.id)?.attention).toBe('review');
    expect(index.get(b.id)?.attention).toBe('conflict');
    const exported = statusExportNode(parent, index.get(parent.id), true);
    expect(exported.evidence?.explanations.at(-1)).toContain('pending recovery');
    expect(parent.evidence?.explanations).not.toEqual(exported.evidence?.explanations);
    expect(exported.evidence?.status).toBe(parent.evidence?.status);
  });
  it('keeps siblings unaffected by a removed descendant while flagging its ancestors', () => {
    const { a, b, model, parent } = fixture();
    const index = finishAuditSteps(folderAvailabilitySteps(model, model.tree!, new Map([[path.join(a.folderPath, 'removed'), null]])));
    expect(index.get(a.id)?.attention).toBe('conflict');
    expect(index.get(parent.id)?.attention).toBe('conflict');
    expect(index.get(b.id)?.attention).toBe('optional');
  });
  it('blocks availability for vault identity gaps and stale snapshots', () => {
    const { model, parent } = fixture();
    model.coverage!.vaultIdentityIssueIds.push('gap');
    expect(finishAuditSteps(folderAvailabilitySteps(model, model.tree!)).get(parent.id)?.adoptable).toBe(false);
    model.coverage!.vaultIdentityIssueIds = [];
    model.stale = true;
    expect(finishAuditSteps(folderAvailabilitySteps(model, model.tree!)).get(parent.id)?.adoptable).toBe(false);
  });
});
