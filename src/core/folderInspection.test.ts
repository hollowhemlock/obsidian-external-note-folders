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
  adoptionBlockerSteps,
  createInspectionIndex,
  evidenceExplanation,
  markedAncestors
} from './folderInspection.ts';
import { folderStatusTable } from './folderStatusCsv.ts';
import { buildGroupAdoptionPlan } from './groupAdoption.ts';
import {
  buildLeafReport,
  buildLeafReportSteps
} from './leafReport.ts';
import {
  DEFAULT_TREE_QUERY,
  queryTree
} from './leafTree.ts';
import { revealTreePath } from './leafTreeNavigation.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
function fixture(): ReturnType<typeof auditFixture> {
  const scan = auditFixture();
  scan.folders.push(...['Project', 'Project/child', 'Other'].map((folder) => path.join(scan.externalRoot, folder)));
  return scan;
}
function marker(scan: ReturnType<typeof auditFixture>, relative: string, unreadable = false): void {
  const folderPath = path.join(scan.externalRoot, relative);
  const markerPath = path.join(folderPath, unreadable ? '.exnf' : `${UUID}.exnf`);
  scan.markers.push({
    folderPath,
    format: unreadable ? 'legacy' : 'uuid-named',
    markerPath,
    status: unreadable ? 'unchecked-marker' : 'valid',
    uuid: unreadable ? '' : UUID
  });
  if (unreadable) {
    scan.issues.push({ kind: 'marker', location: markerPath, reason: 'Cannot read marker', scope: 'external', unchecked: true });
  }
}
describe('folder inspection evidence and navigation', () => {
  it('does not let external exclusions invalidate discovered vault paths', () => {
    const scan = fixture();
    const excluded = path.join(scan.externalRoot, 'Other');
    scan.external.ignoredDirectories.push({ folderPath: excluded, relativePath: 'Other' });
    scan.issues.push({ kind: 'directory', location: excluded, reason: 'Excluded', scope: 'external', unchecked: true });
    const model = buildLeafReport(scan);
    const node = model.tree?.find((item) => item.relativePath === 'Project');
    expect(node?.evidence).toMatchObject({ confidence: 'provisional', exact: 'absent' });
    expect(model.coverage?.vaultPathsComplete).toBe(true);
    expect(model.coverage?.issues[0]?.kind).toBe('excluded');
  });
  it('retains exact paths for unreadable YAML but keeps identity and adoption uncertain', () => {
    const scan = fixture();
    const notePath = path.join(scan.vaultRoot, 'Project.md');
    scan.notes.push({ hasExnf: false, notePath, relativePath: 'Project.md', status: 'unchecked-frontmatter', uuid: '', value: '' });
    scan.issues.push({ kind: 'note', location: notePath, reason: 'Invalid YAML', scope: 'vault', unchecked: true });
    const model = buildLeafReport(scan);
    const node = model.tree?.find((item) => item.relativePath === 'Project');
    expect(node?.evidence).toMatchObject({ exact: 'present', yaml: 'unchecked' });
    expect(model.tree?.find((item) => item.relativePath === 'Other')?.evidence?.exact).toBe('absent');
    expect(model.coverage?.vaultPathsComplete).toBe(true);
    expect(finishAuditSteps(adoptionBlockerSteps(createInspectionIndex(model), node!))[0]?.location).toBe(notePath);
  });
  it('keeps missing exact matches uncertain after a vault directory gap', () => {
    const scan = fixture();
    scan.issues.push({ kind: 'directory', location: path.join(scan.vaultRoot, 'unreadable'), reason: 'Permission denied', scope: 'vault', unchecked: true });
    const model = buildLeafReport(scan);
    expect(model.tree?.every((node) => node.evidence?.exact === 'unchecked')).toBe(true);
    expect(model.coverage?.vaultPathsComplete).toBe(false);
  });
  it('retains found matches through vault gaps and distinguishes legacy issue root boundaries', () => {
    const scan = fixture();
    scan.notes.push({
      hasExnf: false,
      notePath: path.join(scan.vaultRoot, 'Project.md'),
      relativePath: 'Project.md',
      status: 'missing-property',
      uuid: '',
      value: ''
    });
    scan.issues.push({ kind: 'directory', location: scan.vaultRoot, reason: 'Root only partially inspected', unchecked: true });
    const model = buildLeafReport(scan);
    expect(model.tree?.find((node) => node.relativePath === 'Project')?.evidence?.exact).toBe('present');
    expect(model.tree?.find((node) => node.relativePath === 'Other')?.evidence?.exact).toBe('unchecked');
    expect(model.coverage?.vaultPathsComplete).toBe(false);
    scan.issues[0]!.location = `${scan.vaultRoot}-different-root`;
    expect(buildLeafReport(scan).coverage?.vaultPathsComplete).toBe(true);
  });
  it('does not turn unreadable marker identity into unreadable child directories', () => {
    const scan = fixture();
    marker(scan, 'Project', true);
    const model = buildLeafReport(scan);
    const parent = model.tree?.find((node) => node.relativePath === 'Project');
    const child = model.tree?.find((node) => node.relativePath === path.join('Project', 'child'));
    expect(parent?.evidence).toMatchObject({ marker: 'unchecked', status: 'Unchecked' });
    expect(parent?.inspection?.directoryChecked).toBe(true);
    expect(child?.evidence).toMatchObject({ marker: 'absent', physicalLeaf: true, status: 'Inside a marked folder' });
    expect(child?.unchecked).toBe(false);
    expect(parent?.total).toBe(1);
    expect(evidenceExplanation(parent!, 'marker')).toContain('identity could not be read');
  });
  it('lists marked ancestors nearest first, including the external root', () => {
    const scan = fixture();
    marker(scan, '');
    marker(scan, 'Project');
    const model = buildLeafReport(scan);
    const node = model.tree?.find((item) => item.relativePath === path.join('Project', 'child'));
    const index = createInspectionIndex(model);
    expect([...markedAncestors(index, node!)].map((item) => item.relativePath)).toEqual(['Project', '']);
    expect(model.tree?.find((item) => item.relativePath === 'Project')?.evidence?.status).toBe('Identity conflict');
    expect(model.tree?.some((item) => item.folderPath === scan.externalRoot)).toBe(false);
    expect(model.rootFolder?.inspection?.markers).toHaveLength(1);
    expect(model.rootFolder?.total).toBe(2);
  });
  it.each(['ancestor', 'descendant', 'local'] as const)('explains %s marker restrictions also rejected by adoption preflight', (kind) => {
    const scan = fixture();
    marker(scan, kind === 'descendant' ? 'Project/child' : 'Project');
    const selected = kind === 'ancestor' ? 'Project/child' : 'Project';
    const folder = path.join(scan.externalRoot, selected);
    const model = buildLeafReport(scan);
    const node = model.tree?.find((item) => item.folderPath === folder);
    const blockers = finishAuditSteps(adoptionBlockerSteps(createInspectionIndex(model), node!));
    expect(blockers.some((blocker) => blocker.location === scan.markers[0]?.folderPath)).toBe(true);
    expect(() => buildGroupAdoptionPlan({ folderPath: folder, ignorePatterns: [], move: false, mutationSequence: 0, note: null, snapshot: scan, uuid: UUID }))
      .toThrow('Conflicting marker');
  });
  it('identifies excluded and linked descendant paths without affecting unrelated siblings', () => {
    const scan = fixture();
    const folder = path.join(scan.externalRoot, 'Project/child');
    scan.external.ignoredDirectories.push({ folderPath: folder, relativePath: 'Project/child' });
    scan.issues.push({ kind: 'directory', location: folder, reason: 'Excluded', scope: 'external', unchecked: true });
    scan.issues.push({
      kind: 'link',
      location: path.join(scan.externalRoot, 'Project/link'),
      reason: 'Junction not followed',
      scope: 'external',
      unchecked: true
    });
    const model = buildLeafReport(scan);
    const index = createInspectionIndex(model);
    const parent = model.tree?.find((item) => item.relativePath === 'Project');
    const sibling = model.tree?.find((item) => item.relativePath === 'Other');
    const blockers = finishAuditSteps(adoptionBlockerSteps(index, parent!));
    expect(blockers.map((blocker) => blocker.location)).toEqual(expect.arrayContaining(scan.issues.map((issue) => issue.location)));
    expect(blockers.some((blocker) => blocker.message.includes('excluded'))).toBe(true);
    expect(blockers.some((blocker) => blocker.message.includes('junction'))).toBe(true);
    expect(finishAuditSteps(adoptionBlockerSteps(index, sibling!))).toEqual([]);
  });
  it('keeps filter matches and exports separate from contextual and temporarily revealed rows', () => {
    const model = buildLeafReport(fixture());
    const query = queryTree(model, { ...DEFAULT_TREE_QUERY, search: 'child' });
    expect(query.visible.size).toBe(2);
    expect(query.matched.size).toBe(1);
    const other = model.tree?.find((node) => node.relativePath === 'Other');
    const revealed = revealTreePath(query, other!.id);
    expect(revealed.visible.size).toBe(3);
    expect(revealed.matched).toEqual(query.matched);
    expect(revealed.rows).toEqual(query.rows);
    expect(revealed.counts).toEqual(query.counts);
    expect(query.visible.has(other!.id)).toBe(false);
    const exported = folderStatusTable([...revealed.nodes.values()].filter((node) => revealed.matched.has(node.id)));
    expect(exported.rows.map((row) => row['relativePath'])).toEqual([path.join('Project', 'child')]);
  });
  it('keeps shared relationships bounded for deep trees and matches scheduled analysis', async () => {
    const scan = auditFixture();
    let relative = '';
    for (let depth = 0; depth < 250; depth++) {
      relative += '/a';
      scan.folders.push(path.join(scan.externalRoot, relative));
      marker(scan, relative);
    }
    const model = buildLeafReport(scan);
    const scheduled = await runAuditSteps(buildLeafReportSteps(scan));
    expect(scheduled).toEqual(model);
    expect(model.tree?.reduce((sum, node) => sum + (node.inspection?.markers.length ?? 0), 0)).toBe(250);
    expect(model.tree?.filter((node) => !!node.inspection?.ancestorMarkerId)).toHaveLength(249);
  });
});
