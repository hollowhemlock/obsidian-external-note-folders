import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { OpenExternalFolderRecoveryPlan } from './core/openExternalFolderRecovery.ts';

import {
  buildRecoveryDetails,
  describeRecoveryOutcome,
  describeRecoveryReason
} from './openRecoveryPresentation.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const ROOT = path.resolve('external-root');
const FOLDER = path.join(ROOT, 'Projects', 'Alpha');

function buildPlan(overrides: Partial<OpenExternalFolderRecoveryPlan> = {}): OpenExternalFolderRecoveryPlan {
  return {
    activeMatches: [],
    autoOpenFolderPath: null,
    canAdoptExpected: false,
    canCreateExpected: true,
    candidateRows: [],
    errors: [],
    expectedExternalFolder: 'Projects/Alpha',
    expectedFolderPath: FOLDER,
    expectedState: { folderPath: FOLDER, kind: 'missing' },
    externalRootPath: ROOT,
    markdownReport: '',
    notePath: 'Projects/Alpha.md',
    summaryText: 'Recovery summary',
    uuid: UUID,
    warnings: [],
    ...overrides
  };
}

describe('recovery presentation', () => {
  it.each(
    [
      [{ folderPath: FOLDER, kind: 'missing' }, 'not found'],
      [{ folderPath: FOLDER, kind: 'unmarked' }, 'no .exnf marker'],
      [{ folderPath: FOLDER, kind: 'mismatched-marker', markerUuid: UUID }, 'different identifier'],
      [{ folderPath: FOLDER, kind: 'malformed-marker', markerPath: FOLDER, message: 'invalid' }, 'could not be interpreted'],
      [{ folderPath: FOLDER, kind: 'marker-conflict', markerPath: FOLDER, message: 'conflict' }, 'conflicting marker identifiers']
    ] as const
  )('explains why recovery started for %j', (state, reason) => {
    expect(describeRecoveryReason(state)).toContain(reason);
  });

  it('identifies the actual note, full paths, and marker filename', () => {
    expect(buildRecoveryDetails(buildPlan(), 'Searching in')).toEqual([
      { label: 'Note', value: 'Projects/Alpha.md' },
      { label: 'Expected folder', value: FOLDER },
      { label: 'Searching in', value: ROOT },
      { label: 'Marker filename', value: `${UUID}.exnf` }
    ]);
  });

  it('requires confirmed opening rather than auto-open eligibility', () => {
    const plan = buildPlan({ activeMatches: [{ externalFolder: 'Projects/Alpha', folderPath: FOLDER, uuid: UUID }], autoOpenFolderPath: FOLDER });
    expect(describeRecoveryOutcome(plan, null)).toContain('found');
    expect(describeRecoveryOutcome(plan, null)).not.toContain('opened');
    expect(describeRecoveryOutcome(plan, FOLDER)).toContain('opened');
    expect(describeRecoveryOutcome(plan, path.join(ROOT, 'Other'))).not.toContain('opened');
  });

  it('prioritizes blocking errors over a matching folder', () => {
    const plan = buildPlan({ activeMatches: [{ externalFolder: 'Projects/Alpha', folderPath: FOLDER, uuid: UUID }], errors: ['Root inaccessible'] });
    expect(describeRecoveryOutcome(plan, null)).toContain('blocked');
    expect(describeRecoveryOutcome(plan, null)).not.toContain('opened');
  });

  it('explains duplicate matches without claiming one was opened', () => {
    const plan = buildPlan({ activeMatches: [FOLDER, path.join(ROOT, 'Copy')].map((folderPath) => ({ externalFolder: folderPath, folderPath, uuid: UUID })) });
    expect(describeRecoveryOutcome(plan, null)).toContain('Multiple folders');
    expect(describeRecoveryOutcome(plan, null)).toContain('Resolve the duplicate');
  });

  it('distinguishes same-name candidates from marker matches', () => {
    expect(describeRecoveryOutcome(buildPlan(), null)).toContain('No matching .exnf marker');
    const plan = buildPlan({
      candidateRows: [{
        externalFolder: 'Projects/Alpha',
        folderPath: FOLDER,
        markerMessage: null,
        markerStatus: 'unmarked',
        markerUuid: null,
        ownerNotePath: null
      }]
    });
    expect(describeRecoveryOutcome(plan, null)).toContain('same name');
    expect(describeRecoveryOutcome(plan, null)).toContain('review');
  });
});
