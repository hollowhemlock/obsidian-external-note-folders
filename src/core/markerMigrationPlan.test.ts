import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { ExternalScanResult } from './verify.ts';

import { EXNF_LEGACY_MARKER_FILE_NAME } from './contracts.ts';
import { buildExnfMarkerFileName } from './marker.ts';
import {
  buildMarkerMigrationPlan,
  haveSameMarkerMigrationRows
} from './markerMigrationPlan.ts';

const EXTERNAL_ROOT = path.resolve('X:/External');
const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';
const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('marker migration plan', () => {
  it('plans legacy marker renames to UUID-named marker files', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const plan = buildMarkerMigrationPlan({
      externalScan: buildExternalScan({
        legacyMarkers: [{
          folderPath,
          format: 'legacy',
          markerPath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
          uuid: VALID_UUID
        }]
      }),
      mutationSequence: 7
    });

    expect(plan.hasGlobalErrors).toBe(false);
    expect(plan.summaryText).toBe('0 error(s), 0 warning(s), 1 rename(s), 0 already migrated');
    expect(plan.rows).toEqual([{
      externalFolder: 'Projects/Alpha',
      kind: 'rename',
      sourcePath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
      targetPath: path.join(folderPath, buildExnfMarkerFileName(VALID_UUID)),
      uuid: VALID_UUID
    }]);
  });

  it('reports matching UUID-named markers as already migrated', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const plan = buildMarkerMigrationPlan({
      externalScan: buildExternalScan({
        legacyMarkers: [{
          folderPath,
          format: 'legacy',
          markerPath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
          uuid: VALID_UUID
        }],
        markers: [
          {
            folderPath,
            format: 'legacy',
            markerPath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
            uuid: VALID_UUID
          },
          {
            folderPath,
            format: 'uuid-named',
            markerPath: path.join(folderPath, buildExnfMarkerFileName(VALID_UUID)),
            uuid: VALID_UUID
          }
        ]
      }),
      mutationSequence: 7
    });

    expect(plan.summaryText).toBe('0 error(s), 0 warning(s), 0 rename(s), 1 already migrated');
    expect(plan.rows).toEqual([{
      externalFolder: 'Projects/Alpha',
      kind: 'already-migrated',
      message: 'Matching UUID-named marker already exists; legacy marker is stale cleanup evidence.',
      sourcePath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
      targetPath: path.join(folderPath, buildExnfMarkerFileName(VALID_UUID)),
      uuid: VALID_UUID
    }]);
  });

  it('keeps malformed markers and conflicts as global blockers', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const plan = buildMarkerMigrationPlan({
      externalScan: buildExternalScan({
        legacyMarkers: [{
          folderPath,
          format: 'legacy',
          markerPath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
          uuid: VALID_UUID
        }],
        malformedMarkers: [{
          location: path.join(folderPath, 'not-a-uuid.exnf'),
          message: 'Marker filename must be <canonical lowercase UUID>.exnf.'
        }],
        markerConflicts: [{
          location: folderPath,
          message: `Legacy marker disagrees with ${OTHER_UUID}.`
        }]
      }),
      mutationSequence: 7
    });

    expect(plan.hasGlobalErrors).toBe(true);
    expect(plan.errors).toEqual([
      `Malformed marker at ${path.join(folderPath, 'not-a-uuid.exnf')}: Marker filename must be <canonical lowercase UUID>.exnf.`,
      `Marker conflict at ${folderPath}: Legacy marker disagrees with ${OTHER_UUID}.`
    ]);
  });

  it('compares migration row identity independent of mutation sequence', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const first = buildMarkerMigrationPlan({
      externalScan: buildExternalScan({
        legacyMarkers: [{
          folderPath,
          format: 'legacy',
          markerPath: path.join(folderPath, EXNF_LEGACY_MARKER_FILE_NAME),
          uuid: VALID_UUID
        }]
      }),
      mutationSequence: 1
    });
    const second = {
      ...first,
      mutationSequence: 2
    };

    expect(haveSameMarkerMigrationRows(first, second)).toBe(true);
  });
});

function buildExternalScan(input: Partial<ExternalScanResult> = {}): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: new Map(),
    directories: [],
    duplicatePaths: new Map(),
    ignoredDirectories: [],
    ignoreErrors: [],
    ignorePatterns: [],
    legacyMarkers: [],
    malformedMarkers: [],
    markerConflicts: [],
    markers: [],
    rootPath: EXTERNAL_ROOT,
    skippedDirectories: [],
    ...input
  };
}
