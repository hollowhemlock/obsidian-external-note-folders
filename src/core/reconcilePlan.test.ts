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

import { buildReconcilePlan } from './reconcilePlan.ts';

const DIFFERENT_UUID = '123e4567-e89b-42d3-a456-426614174999';
const MOVE_UUID = '123e4567-e89b-42d3-a456-426614174000';
const OK_UUID = '123e4567-e89b-42d3-a456-426614174001';
const ORPHAN_UUID = '123e4567-e89b-42d3-a456-426614174002';
const UNAVAILABLE_UUID = '123e4567-e89b-42d3-a456-426614174003';

describe('reconcile planner', () => {
  it('plans moves, already-correct rows, unavailable rows, and orphans', () => {
    const externalRootPath = path.resolve('external-root');
    const plan = buildReconcilePlan({
      externalScan: buildExternalScan(externalRootPath, {
        bindings: new Map([
          [MOVE_UUID, path.join(externalRootPath, 'Projects', 'Old Alpha')],
          [OK_UUID, path.join(externalRootPath, 'Projects', 'Beta')],
          [ORPHAN_UUID, path.join(externalRootPath, 'Archive', 'Orphan')]
        ]),
        directories: [
          path.join(externalRootPath, 'Archive'),
          path.join(externalRootPath, 'Archive', 'Orphan'),
          path.join(externalRootPath, 'Projects'),
          path.join(externalRootPath, 'Projects', 'Beta'),
          path.join(externalRootPath, 'Projects', 'Old Alpha')
        ]
      }),
      mutationSequence: 7,
      vaultScan: buildVaultScan(
        new Map([
          [MOVE_UUID, 'Projects/Alpha.md'],
          [OK_UUID, 'Projects/Beta.md'],
          [UNAVAILABLE_UUID, 'Projects/Missing.md']
        ])
      )
    });

    expect(plan.errors).toEqual([]);
    expect(plan.mutationSequence).toBe(7);
    expect(plan.rows).toContainEqual({
      currentExternalFolder: 'Projects/Old Alpha',
      kind: 'move',
      notePath: 'Projects/Alpha.md',
      sourcePath: path.join(externalRootPath, 'Projects', 'Old Alpha'),
      targetExternalFolder: 'Projects/Alpha',
      targetPath: path.join(externalRootPath, 'Projects', 'Alpha'),
      uuid: MOVE_UUID
    });
    expect(plan.rows).toContainEqual({
      currentExternalFolder: 'Projects/Beta',
      kind: 'already-correct',
      notePath: 'Projects/Beta.md',
      targetExternalFolder: 'Projects/Beta',
      uuid: OK_UUID
    });
    expect(plan.rows).toContainEqual({
      kind: 'unavailable',
      notePath: 'Projects/Missing.md',
      targetExternalFolder: 'Projects/Missing',
      uuid: UNAVAILABLE_UUID
    });
    expect(plan.rows).toContainEqual({
      currentExternalFolder: 'Archive/Orphan',
      kind: 'orphan',
      uuid: ORPHAN_UUID
    });
    expect(plan.warnings).toEqual([]);
  });

  it('aborts planning when scan integrity errors exist', () => {
    const externalRootPath = path.resolve('external-root');
    const plan = buildReconcilePlan({
      externalScan: buildExternalScan(externalRootPath, {
        accessErrors: [
          {
            location: externalRootPath,
            message: 'missing'
          }
        ]
      }),
      mutationSequence: 0,
      vaultScan: buildVaultScan(new Map([[MOVE_UUID, 'Projects/Alpha.md']]))
    });

    expect(plan.hasGlobalErrors).toBe(true);
    expect(plan.rows).toEqual([]);
    expect(plan.errors).toEqual([
      `External root access error at ${externalRootPath}: missing`
    ]);
  });

  it('includes skipped descendant directories as warnings without blocking planning', () => {
    const externalRootPath = path.resolve('external-root');
    const plan = buildReconcilePlan({
      externalScan: buildExternalScan(externalRootPath, {
        bindings: new Map([[MOVE_UUID, path.join(externalRootPath, 'Projects', 'Old Alpha')]]),
        directories: [
          path.join(externalRootPath, 'Projects'),
          path.join(externalRootPath, 'Projects', 'Old Alpha'),
          path.join(externalRootPath, 'Unreadable')
        ],
        skippedDirectories: [
          {
            location: path.join(externalRootPath, 'Unreadable'),
            message: 'permission denied'
          }
        ]
      }),
      mutationSequence: 0,
      vaultScan: buildVaultScan(new Map([[MOVE_UUID, 'Projects/Alpha.md']]))
    });

    expect(plan.hasGlobalErrors).toBe(false);
    expect(plan.warnings).toEqual([
      `Skipped external directory at ${path.join(externalRootPath, 'Unreadable')}: permission denied`
    ]);
    expect(plan.rows).toContainEqual(expect.objectContaining({
      kind: 'move',
      uuid: MOVE_UUID
    }));
    expect(plan.markdownReport).toContain('## Warnings');
  });

  it('reports occupied target conflicts without aborting unrelated moves', () => {
    const externalRootPath = path.resolve('external-root');
    const plan = buildReconcilePlan({
      externalScan: buildExternalScan(externalRootPath, {
        bindings: new Map([
          [DIFFERENT_UUID, path.join(externalRootPath, 'Projects', 'Alpha')],
          [MOVE_UUID, path.join(externalRootPath, 'Projects', 'Old Alpha')]
        ]),
        directories: [
          path.join(externalRootPath, 'Projects'),
          path.join(externalRootPath, 'Projects', 'Alpha'),
          path.join(externalRootPath, 'Projects', 'Old Alpha')
        ]
      }),
      mutationSequence: 0,
      vaultScan: buildVaultScan(new Map([[MOVE_UUID, 'Projects/Alpha.md']]))
    });

    expect(plan.errors).toEqual([]);
    expect(plan.rows).toContainEqual(expect.objectContaining({
      kind: 'conflict',
      reason: 'target-bound-to-different-uuid',
      uuid: MOVE_UUID
    }));
  });

  it('reports ancestor and descendant bound-folder conflicts', () => {
    const externalRootPath = path.resolve('external-root');
    const ancestorPlan = buildReconcilePlan({
      externalScan: buildExternalScan(externalRootPath, {
        bindings: new Map([
          [DIFFERENT_UUID, path.join(externalRootPath, 'Projects')],
          [MOVE_UUID, path.join(externalRootPath, 'Old Alpha')]
        ]),
        directories: [
          path.join(externalRootPath, 'Old Alpha'),
          path.join(externalRootPath, 'Projects')
        ]
      }),
      mutationSequence: 0,
      vaultScan: buildVaultScan(new Map([[MOVE_UUID, 'Projects/Alpha.md']]))
    });
    const descendantPlan = buildReconcilePlan({
      externalScan: buildExternalScan(externalRootPath, {
        bindings: new Map([
          [DIFFERENT_UUID, path.join(externalRootPath, 'Projects', 'Alpha', 'Child')],
          [MOVE_UUID, path.join(externalRootPath, 'Old Projects')]
        ]),
        directories: [
          path.join(externalRootPath, 'Old Projects'),
          path.join(externalRootPath, 'Projects'),
          path.join(externalRootPath, 'Projects', 'Alpha'),
          path.join(externalRootPath, 'Projects', 'Alpha', 'Child')
        ]
      }),
      mutationSequence: 0,
      vaultScan: buildVaultScan(new Map([[MOVE_UUID, 'Projects/Alpha.md']]))
    });

    expect(ancestorPlan.rows).toContainEqual(expect.objectContaining({
      kind: 'conflict',
      reason: 'ancestor-bound-folder'
    }));
    expect(descendantPlan.rows).toContainEqual(expect.objectContaining({
      kind: 'conflict',
      reason: 'descendant-bound-folder'
    }));
  });
});

function buildExternalScan(
  rootPath: string,
  overrides: Partial<ExternalScanResult> = {}
): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: new Map(),
    directories: [],
    duplicatePaths: new Map(),
    malformedMarkers: [],
    rootPath,
    skippedDirectories: [],
    ...overrides
  };
}

function buildVaultScan(bindings: Map<string, string>): VaultScanResult {
  return {
    bindings,
    duplicatePaths: new Map(),
    invalidFrontmatter: []
  };
}
