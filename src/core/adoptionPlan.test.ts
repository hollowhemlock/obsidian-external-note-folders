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

import {
  buildAdoptionPlan,
  getAdoptionRows,
  haveSameAdoptionRows
} from './adoptionPlan.ts';

const EXTERNAL_ROOT = path.resolve('X:/External');
const EXISTING_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('adoption plan', () => {
  it('adopts exact one-to-one derived path matches', () => {
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [
          path.join(EXTERNAL_ROOT, 'Projects'),
          path.join(EXTERNAL_ROOT, 'Projects', 'Alpha')
        ]
      }),
      mutationSequence: 4,
      notePaths: ['Projects/Alpha.md'],
      vaultScan: buildVaultScan()
    });

    expect(plan.hasGlobalErrors).toBe(false);
    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Projects/Alpha',
        folderPath: path.join(EXTERNAL_ROOT, 'Projects', 'Alpha'),
        kind: 'adopt',
        notePath: 'Projects/Alpha.md'
      }
    ]);
    expect(plan.summaryText).toContain('1 adoptable match(es)');
  });

  it('uses folder-note collapse when matching existing directories', () => {
    const folderPath = path.join(EXTERNAL_ROOT, '0_unsorted', '2025-08-04_wood storage cart');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({ directories: [folderPath] }),
      mutationSequence: 0,
      notePaths: ['0_unsorted/2025-08-04_wood storage cart/2025-08-04_wood storage cart.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: '0_unsorted/2025-08-04_wood storage cart',
        folderPath,
        kind: 'adopt',
        notePath: '0_unsorted/2025-08-04_wood storage cart/2025-08-04_wood storage cart.md'
      }
    ]);
  });

  it('blocks execution when the vault or external root is not pristine', () => {
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        bindings: new Map([[EXISTING_UUID, path.join(EXTERNAL_ROOT, 'Projects', 'Alpha')]])
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Beta.md'],
      vaultScan: buildVaultScan({
        bindings: new Map([[EXISTING_UUID, 'Projects/Alpha.md']])
      })
    });

    expect(plan.hasGlobalErrors).toBe(true);
    expect(plan.errors).toContain(`Existing vault identity at Projects/Alpha.md: ${EXISTING_UUID}`);
    expect(plan.errors).toContain(`Existing external marker at Projects/Alpha: ${EXISTING_UUID}`);
    expect(plan.rows).toEqual([]);
  });

  it('reports duplicate note targets without adopting either note', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({ directories: [folderPath] }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Projects/Alpha/Alpha.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([]);
    expect(plan.rows.filter((row) => row.kind === 'blocked-note')).toHaveLength(2);
  });

  it('does not also report candidate directories as unmatched when notes are blocked', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({ directories: [folderPath] }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Projects/Alpha/Alpha.md'],
      vaultScan: buildVaultScan()
    });

    expect(plan.rows.filter((row) => row.kind === 'unmatched-external-folder')).toEqual([]);
  });

  it('reports notes that cannot derive an external path as blocked rows', () => {
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan(),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.txt'],
      vaultScan: buildVaultScan()
    });

    expect(plan.rows).toEqual([
      {
        externalFolder: null,
        kind: 'blocked-note',
        message: 'Expected a markdown note path, received \'Projects/Alpha.txt\'.',
        notePath: 'Projects/Alpha.txt',
        reason: 'derived-path-error'
      }
    ]);
  });

  it('compares adoption row identity independent of row order', () => {
    const left = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [
          path.join(EXTERNAL_ROOT, 'Projects', 'Alpha'),
          path.join(EXTERNAL_ROOT, 'Projects', 'Beta')
        ]
      }),
      mutationSequence: 1,
      notePaths: ['Projects/Alpha.md', 'Projects/Beta.md'],
      vaultScan: buildVaultScan()
    });
    const right = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [
          path.join(EXTERNAL_ROOT, 'Projects', 'Beta'),
          path.join(EXTERNAL_ROOT, 'Projects', 'Alpha')
        ]
      }),
      mutationSequence: 2,
      notePaths: ['Projects/Beta.md', 'Projects/Alpha.md'],
      vaultScan: buildVaultScan()
    });

    expect(haveSameAdoptionRows(left, right)).toBe(true);
  });
});

function buildExternalScan(input: Partial<ExternalScanResult> = {}): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: new Map(),
    directories: [],
    duplicatePaths: new Map(),
    malformedMarkers: [],
    rootPath: EXTERNAL_ROOT,
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
