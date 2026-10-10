import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import { buildMarkerRepairPlan } from './markerRepair.ts';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const root = path.resolve('external');
function fixture(): Parameters<typeof buildMarkerRepairPlan>[0] {
  return {
    context: {
      externalRootPath: root,
      ignorePatterns: [],
      knownFolders: [],
      notePath: 'Alpha/Alpha.md',
      targetPath: path.join(root, 'Alpha'),
      templatePatterns: [],
      uuid
    },
    inspection: {
      ancestorMarkerPaths: [],
      descendantMarkerPaths: [],
      directoryPaths: [],
      errors: [],
      externalRootPath: root,
      ignoredDirectories: [],
      legacyMarkerPaths: [],
      omissions: [{ location: path.join(root, 'Alpha/node_modules'), reason: 'Git rule .gitignore:1: node_modules/' }],
      skippedDirectories: [],
      targetIgnored: false,
      targetKind: 'directory' as const,
      targetMarkerUuids: [],
      targetPath: path.join(root, 'Alpha')
    },
    knownMatches: [],
    mutationSequence: 4,
    notes: [{ identity: { kind: 'valid' as const, uuid }, notePath: 'Alpha/Alpha.md' }]
  };
}
describe('missing marker repair plans', () => {
  it('allows intentional omissions and ordinary descendant notes without assigning identity', () => {
    const input = fixture();
    const plan = buildMarkerRepairPlan(input);
    expect(plan.errors).toEqual([]);
    expect(plan.uuid).toBe(uuid);
    expect(plan.action).toBe('create-missing-marker');
    expect(plan.omissions).toHaveLength(1);
    expect(buildMarkerRepairPlan({ ...input, notes: [...input.notes, { identity: { kind: 'missing' }, notePath: 'Alpha/Child.md' }] }).errors).toEqual([]);
  });
  it('blocks changed ownership, ambiguous exact paths, and identified descendants', () => {
    for (const notePath of ['Other.md', 'Alpha.md', 'Alpha/Child.md']) {
      const input = fixture();
      input.notes = [...input.notes, { identity: { kind: 'valid', uuid }, notePath }];
      expect(buildMarkerRepairPlan(input).errors.length).toBeGreaterThan(0);
    }
    expect(buildMarkerRepairPlan({ ...fixture(), notes: [] }).errors.join(' ')).toContain('identity');
  });
  it('accepts an already matching marker but rejects other local or nested evidence', () => {
    const input = fixture();
    expect(buildMarkerRepairPlan({ ...input, inspection: { ...input.inspection, targetMarkerUuids: [uuid] } })).toMatchObject({
      errors: [],
      markerPresent: true
    });
    expect(buildMarkerRepairPlan({ ...input, inspection: { ...input.inspection, descendantMarkerPaths: ['child/marker.exnf'] } }).errors.length)
      .toBeGreaterThan(0);
    expect(buildMarkerRepairPlan({ ...input, knownMatches: ['elsewhere'] }).errors.join(' ')).toContain('elsewhere');
  });
});
