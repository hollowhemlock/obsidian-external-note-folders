import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import {
  aliasesWithPreviousName,
  buildGroupAdoptionPlan,
  noteMatchReason
} from './groupAdoption.ts';
import {
  DEFAULT_LEAF_QUERY,
  maximumGroupDepth,
  queryLeaves
} from './leafQuery.ts';
import { buildLeafReport } from './leafReport.ts';

const UUID = '11111111-1111-4111-8111-111111111111';
function addNote(input: ReturnType<typeof fixture>, relativePath: string, uuid = ''): void {
  input.snapshot.notes.push({
    hasExnf: !!uuid,
    notePath: path.join(input.snapshot.vaultRoot, relativePath),
    relativePath,
    status: uuid ? 'valid' : 'missing-property',
    uuid,
    value: uuid
  });
}
function fixture(): Parameters<typeof buildGroupAdoptionPlan>[0] {
  const snapshot = auditFixture();
  const folderPath = path.join(snapshot.externalRoot, 'Projects', 'Example');
  snapshot.folders.push(folderPath);
  return { folderPath, ignorePatterns: [], move: false, mutationSequence: 0, note: null, snapshot, uuid: UUID };
}
describe('explicit folder group adoption', () => {
  it('rejects excluded sources and destinations for binding, creation, and note moves', () => {
    const input = fixture();
    addNote(input, 'Draft.tpl.md');
    input.snapshot.templateExclusions = { paths: [], patterns: ['*.tpl.md'] };
    for (const move of [false, true]) {
      expect(() => buildGroupAdoptionPlan({ ...input, move, note: { aliases: [], path: 'Draft.tpl.md' } })).toThrow('excluded');
    }
    input.snapshot.templateExclusions.patterns = ['/Projects/'];
    expect(() => buildGroupAdoptionPlan(input)).toThrow('excluded');
    addNote(input, 'Other.md');
    expect(() => buildGroupAdoptionPlan({ ...input, move: true, note: { aliases: [], path: 'Other.md' } })).toThrow('excluded');
    expect(buildGroupAdoptionPlan({ ...input, note: { aliases: [], path: 'Other.md' } }).templateExcludePatterns).toEqual(['/Projects/']);
  });

  it('creates minimal matching paths and recognizes folder notes', () => {
    const input = fixture();
    expect(buildGroupAdoptionPlan(input).notePath).toBe('Projects/Example.md');
    addNote(input, 'Projects/Example/Example.md');
    expect(buildGroupAdoptionPlan({ ...input, note: { aliases: undefined, path: 'Projects/Example/Example.md' } }).warnings).toEqual([]);
    expect(() => buildGroupAdoptionPlan(input)).toThrow('same target');
  });
  it('supports alias suggestions and arbitrary vault search without duplicate suggestions', () => {
    const note = { aliases: ['Example', 'Alternate'], path: 'Elsewhere/Old.md' };
    const input = fixture();
    expect(noteMatchReason(note, input.folderPath, input.snapshot.externalRoot)).toBe('Alias: Example');
    expect(noteMatchReason(note, input.folderPath, input.snapshot.externalRoot, 'alternate')).toBe('Alias: Example');
    expect(noteMatchReason(note, input.folderPath, input.snapshot.externalRoot, 'absent')).toBeNull();
  });
  it('preserves aliases and rejects unsafe alias coercion', () => {
    expect(aliasesWithPreviousName('Old', 'old')).toEqual(['Old']);
    expect(aliasesWithPreviousName(['Other'], 'Old')).toEqual(['Other', 'Old']);
    expect(() => aliasesWithPreviousName({ name: 'Other' }, 'Old')).toThrow('malformed');
  });
  it('binds without moving and explains occupied reconcile destinations', () => {
    const input = fixture();
    addNote(input, 'Elsewhere/Old.md');
    input.snapshot.folders.push(path.join(input.snapshot.externalRoot, 'Elsewhere', 'Old'));
    const plan = buildGroupAdoptionPlan({ ...input, note: { aliases: [], path: 'Elsewhere/Old.md' } });
    expect(plan.notePath).toBe('Elsewhere/Old.md');
    expect(plan.warnings.join(' ')).toContain('already exists');
    expect(buildGroupAdoptionPlan({ ...input, move: true, note: { aliases: [], path: 'Elsewhere/Old.md' } }).aliases).toEqual(['Old']);
  });
  it('reuses unique UUIDs but blocks missing evidence and duplicate notes', () => {
    const input = fixture();
    addNote(input, 'Projects/Example.md', UUID);
    const args = { ...input, note: { aliases: [], path: 'Projects/Example.md' } };
    expect(buildGroupAdoptionPlan(args).uuid).toBe(UUID);
    input.snapshot.issues.push({ location: path.join(input.snapshot.externalRoot, 'unrelated'), reason: 'EACCES', unchecked: true });
    expect(() => buildGroupAdoptionPlan(args)).toThrow('Unchecked');
    input.snapshot.issues = [];
    addNote(input, 'Duplicate.md', UUID);
    expect(() => buildGroupAdoptionPlan(args)).toThrow('another note');
  });
  it('blocks markers in sibling branches hidden from the leaf report', () => {
    const input = fixture();
    input.snapshot.markers.push({
      folderPath: path.join(input.folderPath, 'hidden'),
      format: 'unknown',
      markerPath: path.join(input.folderPath, 'hidden', 'broken.EXNF'),
      status: 'invalid-marker',
      uuid: ''
    });
    expect(() => buildGroupAdoptionPlan(input)).toThrow('Conflicting marker');
  });
  it('allows unassigned descendants but rejects identified and unchecked descendants', () => {
    const input = fixture();
    addNote(input, 'Projects/Example/Child.md');
    expect(buildGroupAdoptionPlan(input).descendants).toEqual(['Projects/Example/Child.md']);
    input.snapshot.issues.push({ location: path.join(input.folderPath, 'link'), reason: 'link', unchecked: true });
    expect(() => buildGroupAdoptionPlan(input)).toThrow('Unchecked');
    input.snapshot.issues = [];
    input.snapshot.notes[0]!.hasExnf = true;
    expect(() => buildGroupAdoptionPlan(input)).toThrow('reserves');
  });
  it('blocks ignored targets and root adoption', () => {
    const input = fixture();
    expect(() => buildGroupAdoptionPlan({ ...input, ignorePatterns: ['Projects/'] })).toThrow('Ignored');
    expect(() => buildGroupAdoptionPlan({ ...input, folderPath: input.snapshot.externalRoot })).toThrow('root');
  });
  it('groups terminal leaves at every depth with actual folder paths', () => {
    const scan = auditFixture();
    scan.folders = ['Receipts', 'Projects/Example/Documents', 'Projects/Example/Images', 'a/b/c/d/e/f'].map((p) => path.join(scan.externalRoot, p));
    const model = buildLeafReport(scan);
    expect(maximumGroupDepth(model)).toBe(6);
    const result = queryLeaves(model, { ...DEFAULT_LEAF_QUERY, depth: 3 });
    expect(result.groups.some((group) => group.key === 'Receipts' && group.folderPath === path.join(scan.externalRoot, 'Receipts'))).toBe(true);
    expect(result.groups.some((group) => group.key === 'Projects/Example/Documents')).toBe(true);
    expect(queryLeaves(model, { ...DEFAULT_LEAF_QUERY, depth: 99 }).groups.some((group) => group.key === 'a/b/c/d/e/f')).toBe(true);
  });
});
