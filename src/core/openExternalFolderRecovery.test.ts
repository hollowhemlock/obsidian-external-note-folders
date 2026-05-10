import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import { buildOpenExternalFolderRecoveryPlan } from './openExternalFolderRecovery.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';

describe('open external folder recovery plan', () => {
  it('opens exactly one off-path active UUID match by default', () => {
    const externalRootPath = path.resolve('external-root');
    const actualFolderPath = path.join(externalRootPath, 'Projects', 'Old Alpha');
    const plan = buildOpenExternalFolderRecoveryPlan({
      expectedState: {
        folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
        kind: 'missing'
      },
      externalScan: buildExternalScan({
        bindings: new Map([[UUID, actualFolderPath]]),
        directories: [actualFolderPath],
        rootPath: externalRootPath
      }),
      notePath: 'Projects/Alpha.md',
      uuid: UUID,
      vaultScan: buildVaultScan()
    });

    expect(plan.autoOpenFolderPath).toBe(actualFolderPath);
    expect(plan.activeMatches).toEqual([{
      externalFolder: 'Projects/Old Alpha',
      folderPath: actualFolderPath,
      uuid: UUID
    }]);
    expect(plan.canCreateExpected).toBe(false);
  });

  it('blocks auto-open when copied markers duplicate the active UUID', () => {
    const externalRootPath = path.resolve('external-root');
    const firstFolderPath = path.join(externalRootPath, 'Projects', 'Alpha Copy 1');
    const secondFolderPath = path.join(externalRootPath, 'Projects', 'Alpha Copy 2');
    const plan = buildOpenExternalFolderRecoveryPlan({
      expectedState: {
        folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
        kind: 'missing'
      },
      externalScan: buildExternalScan({
        bindings: new Map([[UUID, firstFolderPath]]),
        directories: [firstFolderPath, secondFolderPath],
        duplicatePaths: new Map([[UUID, [firstFolderPath, secondFolderPath]]]),
        rootPath: externalRootPath
      }),
      notePath: 'Projects/Alpha.md',
      uuid: UUID,
      vaultScan: buildVaultScan()
    });

    expect(plan.autoOpenFolderPath).toBeNull();
    expect(plan.activeMatches.map((row) => row.externalFolder)).toEqual([
      'Projects/Alpha Copy 1',
      'Projects/Alpha Copy 2'
    ]);
    expect(plan.canCreateExpected).toBe(false);
  });

  it('classifies exact-name candidates by marker status and owner note', () => {
    const externalRootPath = path.resolve('external-root');
    const unmarkedFolderPath = path.join(externalRootPath, 'Archive', 'Alpha');
    const activeFolderPath = path.join(externalRootPath, 'Moved', 'Alpha');
    const otherFolderPath = path.join(externalRootPath, 'Other', 'Alpha');
    const malformedFolderPath = path.join(externalRootPath, 'Broken', 'Alpha');
    const ignoredFolderPath = path.join(externalRootPath, 'Archive', 'Alpha Backup');
    const plan = buildOpenExternalFolderRecoveryPlan({
      expectedState: {
        folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
        kind: 'unmarked'
      },
      externalScan: buildExternalScan({
        bindings: new Map([
          [OTHER_UUID, otherFolderPath],
          [UUID, activeFolderPath]
        ]),
        directories: [
          unmarkedFolderPath,
          activeFolderPath,
          otherFolderPath,
          malformedFolderPath,
          ignoredFolderPath
        ],
        malformedMarkers: [{
          location: path.join(malformedFolderPath, '.exnf'),
          message: 'Invalid marker'
        }],
        rootPath: externalRootPath
      }),
      notePath: 'Projects/Alpha.md',
      uuid: UUID,
      vaultScan: buildVaultScan({
        bindings: new Map([[OTHER_UUID, 'Other.md']])
      })
    });

    expect(plan.candidateRows.map((row) => ({
      externalFolder: row.externalFolder,
      markerStatus: row.markerStatus,
      ownerNotePath: row.ownerNotePath
    }))).toEqual([
      {
        externalFolder: 'Moved/Alpha',
        markerStatus: 'bound-active',
        ownerNotePath: null
      },
      {
        externalFolder: 'Other/Alpha',
        markerStatus: 'bound-other',
        ownerNotePath: 'Other.md'
      },
      {
        externalFolder: 'Broken/Alpha',
        markerStatus: 'malformed-marker',
        ownerNotePath: null
      },
      {
        externalFolder: 'Archive/Alpha',
        markerStatus: 'unmarked',
        ownerNotePath: null
      }
    ]);
  });

  it('offers expected-folder actions only when no active UUID match exists', () => {
    const externalRootPath = path.resolve('external-root');

    expect(
      buildOpenExternalFolderRecoveryPlan({
        expectedState: {
          folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
          kind: 'missing'
        },
        externalScan: buildExternalScan({ rootPath: externalRootPath }),
        notePath: 'Projects/Alpha.md',
        uuid: UUID,
        vaultScan: buildVaultScan()
      }).canCreateExpected
    ).toBe(true);

    expect(
      buildOpenExternalFolderRecoveryPlan({
        expectedState: {
          folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
          kind: 'unmarked'
        },
        externalScan: buildExternalScan({ rootPath: externalRootPath }),
        notePath: 'Projects/Alpha.md',
        uuid: UUID,
        vaultScan: buildVaultScan()
      }).canAdoptExpected
    ).toBe(true);
  });

  it('reports skipped directories and non-candidate malformed marker warnings', () => {
    const externalRootPath = path.resolve('external-root');
    const plan = buildOpenExternalFolderRecoveryPlan({
      expectedState: {
        folderPath: path.join(externalRootPath, 'Projects', 'Alpha'),
        kind: 'missing'
      },
      externalScan: buildExternalScan({
        malformedMarkers: [{
          location: path.join(externalRootPath, 'Other', '.exnf'),
          message: 'Invalid marker'
        }],
        rootPath: externalRootPath,
        skippedDirectories: [{
          location: path.join(externalRootPath, '.tmp'),
          message: 'EPERM'
        }]
      }),
      notePath: 'Projects/Alpha.md',
      uuid: UUID,
      vaultScan: buildVaultScan()
    });

    expect(plan.warnings).toEqual([
      `Malformed non-candidate marker at ${path.join(externalRootPath, 'Other', '.exnf')}: Invalid marker`,
      `Skipped external directory at ${path.join(externalRootPath, '.tmp')}: EPERM`
    ]);
  });
});

function buildExternalScan(input: Partial<ExternalScanResult> = {}): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: new Map(),
    directories: [],
    duplicatePaths: new Map(),
    malformedMarkers: [],
    rootPath: path.resolve('external-root'),
    skippedDirectories: [],
    ...input
  };
}

function buildVaultScan(input: Partial<VaultScanResult> = {}): VaultScanResult {
  return {
    bindings: new Map(),
    duplicatePaths: new Map(),
    invalidFrontmatter: [],
    ...input
  };
}
