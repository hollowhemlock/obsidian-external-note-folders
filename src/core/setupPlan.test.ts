import path from 'node:path';
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
const EXTERNAL_ROOT = path.resolve('External');

describe('external folder setup planning', () => {
  it('creates a missing target without whole-root evidence', () => {
    expect(buildPlan(inspection({ targetKind: 'missing' })).action).toBe('create-new');
  });

  it('requires confirmation for an existing unmarked target', () => {
    expect(buildPlan(inspection()).action).toBe('confirm-unmarked-adoption');
  });

  it.each(['Alpha/Alpha.md', 'Alpha/Child.md', 'Parent.md'])(
    'blocks a target reserved by identified note %s without external markers',
    (ownerPath) => {
      const targetPath = path.join(EXTERNAL_ROOT, ownerPath === 'Parent.md' ? 'Parent/Alpha' : 'Alpha');
      for (const targetKind of ['missing', 'directory'] as const) {
        for (
          const vault of [
            vaultScan({ bindings: new Map([[UUID, ownerPath]]) }),
            vaultScan({ duplicatePaths: new Map([[UUID, [ownerPath, 'Other.md']]]) })
          ]
        ) {
          const result = buildPlan(inspection({ targetKind, targetPath }), [], vault, ownerPath === 'Parent.md' ? 'Parent/Alpha.md' : 'Alpha.md');
          expect(result.action).toBe('block');
          expect(result.errors.join(' ')).toContain(ownerPath);
        }
      }
    }
  );

  it('does not treat a path prefix as a reserved ancestor', () => {
    expect(buildPlan(inspection(), [], vaultScan({ bindings: new Map([[UUID, 'Al.md']]) })).action)
      .toBe('confirm-unmarked-adoption');
  });

  it('blocks restoration with unreadable markers but accepts unrelated malformed contents', () => {
    const selected = buildPlan(inspection({ targetMarkerUuids: [UUID] }));
    const issue = { location: path.join(EXTERNAL_ROOT, 'Other', '.exnf'), message: 'permission denied' };
    expect(validateSetupRestoration(selected, externalScan({ malformedMarkers: [issue], markerReadErrors: [issue] }), vaultScan()).action)
      .toBe('block');
    expect(validateSetupRestoration(selected, externalScan({ malformedMarkers: [issue], markerReadErrors: [] }), vaultScan()).action)
      .toBe('confirm-marker-restore');
  });

  it('selects one imported target identity for restoration', () => {
    expect(buildPlan(inspection({ targetMarkerUuids: [UUID] }))).toMatchObject({
      action: 'confirm-marker-restore',
      uuid: UUID
    });
  });

  it('blocks marker overlap, skipped evidence, and deeper exact candidates', () => {
    expect(buildPlan(inspection({ descendantMarkerPaths: [path.join(EXTERNAL_ROOT, 'Alpha/Child/id.exnf')] })).action).toBe('block');
    expect(buildPlan(inspection({ skippedDirectories: [path.join(EXTERNAL_ROOT, 'Alpha/Unreadable')] })).action).toBe('block');
    expect(buildPlan(inspection({ directoryPaths: [path.join(EXTERNAL_ROOT, 'Alpha/Child')] }), ['Alpha/Child.md']).action).toBe('block');
  });

  it('ignores unrelated notes without a supported derived path', () => {
    expect(buildPlan(inspection(), ['README.MD']).action).toBe('confirm-unmarked-adoption');
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
      externalScan({ skippedDirectories: [{ location: path.join(EXTERNAL_ROOT, 'Hidden'), message: 'EPERM' }] }),
      vaultScan()
    );
    expect(skipped.action).toBe('block');

    const inaccessible = validateSetupRestoration(
      selected,
      externalScan({ accessErrors: [{ location: EXTERNAL_ROOT, message: 'unreadable root' }] }),
      vaultScan()
    );
    expect(inaccessible.action).toBe('block');

    const ignored = validateSetupRestoration(
      selected,
      externalScan({ ignoredDirectories: [{ folderPath: path.join(EXTERNAL_ROOT, 'Ignored'), relativePath: 'Ignored' }] }),
      vaultScan()
    );
    expect(ignored).toMatchObject({ action: 'confirm-marker-restore', ignoredDirectoryCount: 1 });

    const duplicate = validateSetupRestoration(
      selected,
      externalScan({
        bindings: new Map(),
        duplicatePaths: new Map([[UUID, [path.join(EXTERNAL_ROOT, 'Alpha'), path.join(EXTERNAL_ROOT, 'Other')]]])
      }),
      vaultScan()
    );
    expect(duplicate.action).toBe('block');
  });
});

function buildPlan(
  targetInspection: SetupTargetInspection,
  notePaths: string[] = [],
  vault = vaultScan(),
  notePath = 'Alpha.md'
): ReturnType<typeof buildSetupPlan> {
  return buildSetupPlan({
    identity: { kind: 'missing' },
    inspection: targetInspection,
    mutationSequence: 0,
    notePath,
    notePaths: [notePath, ...notePaths],
    vaultScan: vault
  });
}

function externalScan(overrides: Partial<ExternalScanResult> = {}): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: new Map([[UUID, path.join(EXTERNAL_ROOT, 'Alpha')]]),
    directories: [],
    duplicatePaths: new Map(),
    ignoredDirectories: [],
    ignoreErrors: [],
    ignorePatterns: [],
    malformedMarkers: [],
    rootPath: EXTERNAL_ROOT,
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
    externalRootPath: EXTERNAL_ROOT,
    ignoredDirectories: [],
    legacyMarkerPaths: [],
    skippedDirectories: [],
    targetIgnored: false,
    targetKind: 'directory',
    targetMarkerUuids: [],
    targetPath: path.join(EXTERNAL_ROOT, 'Alpha'),
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
