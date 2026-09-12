import {
  describe,
  expect,
  it
} from 'vitest';

import type { SetupTargetInspection } from './setupPlan.ts';
import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import {
  buildSetupPlan,
  validateSetupRestoration
} from './setupPlan.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('external folder setup planning', () => {
  it('creates a missing target without whole-root evidence', () => {
    expect(buildPlan(inspection({ targetKind: 'missing' })).action).toBe('create-new');
  });

  it('requires confirmation for an existing unmarked target', () => {
    expect(buildPlan(inspection()).action).toBe('confirm-unmarked-adoption');
  });

  it('selects one imported target identity for restoration', () => {
    expect(buildPlan(inspection({ targetMarkerUuids: [UUID] }))).toMatchObject({
      action: 'confirm-marker-restore',
      uuid: UUID
    });
  });

  it('blocks marker overlap, skipped evidence, and deeper exact candidates', () => {
    expect(buildPlan(inspection({ descendantMarkerPaths: ['X:/External/Alpha/Child/id.exnf'] })).action).toBe('block');
    expect(buildPlan(inspection({ skippedDirectories: ['X:/External/Alpha/Unreadable'] })).action).toBe('block');
    expect(buildPlan(inspection({ directoryPaths: ['X:/External/Alpha/Child'] }), ['Alpha/Child.md']).action).toBe('block');
  });

  it('blocks ignored targets, distinct target identities, and UUIDs already owned in the vault', () => {
    expect(buildPlan(inspection({ targetIgnored: true })).action).toBe('block');
    expect(buildPlan(inspection({ targetMarkerUuids: [UUID, '223e4567-e89b-42d3-a456-426614174000'] })).action)
      .toBe('block');
    expect(buildPlan(inspection({ targetMarkerUuids: [UUID] }), [], vaultScan({ bindings: new Map([[UUID, 'Other.md']]) })).action)
      .toBe('block');
  });

  it('requires a unique complete external scan before restoration', () => {
    const selected = buildPlan(inspection({ targetMarkerUuids: [UUID] }));
    const valid = validateSetupRestoration(selected, externalScan(), vaultScan());
    expect(valid.action).toBe('confirm-marker-restore');

    const skipped = validateSetupRestoration(
      selected,
      externalScan({ skippedDirectories: [{ location: 'X:/External/Hidden', message: 'EPERM' }] }),
      vaultScan()
    );
    expect(skipped.action).toBe('block');

    const inaccessible = validateSetupRestoration(
      selected,
      externalScan({ accessErrors: [{ location: 'X:/External', message: 'unreadable root' }] }),
      vaultScan()
    );
    expect(inaccessible.action).toBe('block');

    const ignored = validateSetupRestoration(
      selected,
      externalScan({ ignoredDirectories: [{ folderPath: 'X:/External/Ignored', relativePath: 'Ignored' }] }),
      vaultScan()
    );
    expect(ignored).toMatchObject({ action: 'confirm-marker-restore', ignoredDirectoryCount: 1 });

    const duplicate = validateSetupRestoration(
      selected,
      externalScan({
        bindings: new Map(),
        duplicatePaths: new Map([[UUID, ['X:/External/Alpha', 'X:/External/Other']]])
      }),
      vaultScan()
    );
    expect(duplicate.action).toBe('block');
  });
});

function buildPlan(
  targetInspection: SetupTargetInspection,
  notePaths: string[] = [],
  vault = vaultScan()
): ReturnType<typeof buildSetupPlan> {
  return buildSetupPlan({
    identity: { kind: 'missing' },
    inspection: targetInspection,
    mutationSequence: 0,
    notePath: 'Alpha.md',
    notePaths: ['Alpha.md', ...notePaths],
    vaultScan: vault
  });
}

function externalScan(overrides: Partial<ExternalScanResult> = {}): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: new Map([[UUID, 'X:/External/Alpha']]),
    directories: [],
    duplicatePaths: new Map(),
    ignoredDirectories: [],
    ignoreErrors: [],
    ignorePatterns: [],
    malformedMarkers: [],
    rootPath: 'X:/External',
    skippedDirectories: [],
    ...overrides
  };
}

function inspection(overrides: Partial<SetupTargetInspection> = {}): SetupTargetInspection {
  return {
    ancestorMarkerPaths: [],
    descendantMarkerPaths: [],
    directoryPaths: [],
    errors: [],
    externalRootPath: 'X:/External',
    ignoredDirectories: [],
    legacyMarkerPaths: [],
    skippedDirectories: [],
    targetIgnored: false,
    targetKind: 'directory',
    targetMarkerUuids: [],
    targetPath: 'X:/External/Alpha',
    ...overrides
  };
}

function vaultScan(overrides: Partial<VaultScanResult> = {}): VaultScanResult {
  return {
    bindings: new Map(),
    duplicatePaths: new Map(),
    invalidFrontmatter: [],
    ...overrides
  };
}
