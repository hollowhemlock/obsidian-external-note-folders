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

  it('keeps unrelated existing identities and markers as warnings', () => {
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        bindings: new Map([[EXISTING_UUID, path.join(EXTERNAL_ROOT, 'Projects', 'Alpha')]]),
        directories: [path.join(EXTERNAL_ROOT, 'Projects', 'Beta')]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Beta.md'],
      vaultScan: buildVaultScan({
        bindings: new Map([[EXISTING_UUID, 'Projects/Alpha.md']])
      })
    });

    expect(plan.hasGlobalErrors).toBe(false);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toContain(`Existing vault identity at Projects/Alpha.md: ${EXISTING_UUID}`);
    expect(plan.warnings).toContain(`Existing external marker at Projects/Alpha: ${EXISTING_UUID}`);
    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Projects/Beta',
        folderPath: path.join(EXTERNAL_ROOT, 'Projects', 'Beta'),
        kind: 'adopt',
        notePath: 'Projects/Beta.md'
      }
    ]);
  });

  it('adopts an exact match when unrelated markers and skipped directories exist', () => {
    const healthFolderPath = path.join(EXTERNAL_ROOT, 'projects', 'health_mental');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        bindings: new Map([[EXISTING_UUID, path.join(EXTERNAL_ROOT, 'projects', 'old')]]),
        directories: [
          healthFolderPath,
          path.join(EXTERNAL_ROOT, 'projects', 'old'),
          path.join(EXTERNAL_ROOT, 'tmp')
        ],
        skippedDirectories: [
          {
            location: path.join(EXTERNAL_ROOT, 'tmp'),
            message: 'EPERM'
          }
        ]
      }),
      mutationSequence: 0,
      notePaths: ['projects/health_mental/health_mental.md'],
      vaultScan: buildVaultScan({
        bindings: new Map([[EXISTING_UUID, 'projects/old.md']])
      })
    });

    expect(plan.hasGlobalErrors).toBe(false);
    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'projects/health_mental',
        folderPath: healthFolderPath,
        kind: 'adopt',
        notePath: 'projects/health_mental/health_mental.md'
      }
    ]);
    expect(plan.warnings).toContain(`Skipped external directory at ${path.join(EXTERNAL_ROOT, 'tmp')}: EPERM`);
  });

  it('blocks only the note whose target folder has an existing marker', () => {
    const alphaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const betaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Beta');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        bindings: new Map([[EXISTING_UUID, alphaFolderPath]]),
        directories: [alphaFolderPath, betaFolderPath]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Projects/Beta.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Projects/Beta',
        folderPath: betaFolderPath,
        kind: 'adopt',
        notePath: 'Projects/Beta.md'
      }
    ]);
    expect(plan.rows).toContainEqual({
      externalFolder: 'Projects/Alpha',
      kind: 'blocked-note',
      message: `Derived external folder path already has marker UUID(s): ${EXISTING_UUID}`,
      notePath: 'Projects/Alpha.md',
      reason: 'target-already-bound'
    });
  });

  it('blocks only the note whose target folder has a malformed marker', () => {
    const alphaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const betaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Beta');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [alphaFolderPath, betaFolderPath],
        malformedMarkers: [
          {
            location: path.join(alphaFolderPath, '.exnf'),
            message: 'Invalid marker'
          }
        ]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Projects/Beta.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Projects/Beta',
        folderPath: betaFolderPath,
        kind: 'adopt',
        notePath: 'Projects/Beta.md'
      }
    ]);
    expect(plan.rows).toContainEqual({
      externalFolder: 'Projects/Alpha',
      kind: 'blocked-note',
      message: 'Derived external folder path contains a malformed marker.',
      notePath: 'Projects/Alpha.md',
      reason: 'target-has-malformed-marker'
    });
  });

  it('blocks only the note whose target is inside an ancestor marker', () => {
    const alphaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const betaFolderPath = path.join(EXTERNAL_ROOT, 'Other', 'Beta');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        bindings: new Map([[EXISTING_UUID, path.join(EXTERNAL_ROOT, 'Projects')]]),
        directories: [alphaFolderPath, betaFolderPath]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Other/Beta.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Other/Beta',
        folderPath: betaFolderPath,
        kind: 'adopt',
        notePath: 'Other/Beta.md'
      }
    ]);
    expect(plan.rows).toContainEqual({
      externalFolder: 'Projects/Alpha',
      kind: 'blocked-note',
      message: `Ancestor bound folder overlaps the derived external folder path: ${EXISTING_UUID}`,
      notePath: 'Projects/Alpha.md',
      reason: 'ancestor-bound-folder'
    });
  });

  it('blocks only the note whose target contains a descendant marker', () => {
    const alphaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const betaFolderPath = path.join(EXTERNAL_ROOT, 'Other', 'Beta');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        bindings: new Map([[EXISTING_UUID, path.join(EXTERNAL_ROOT, 'Projects', 'Alpha', 'Child')]]),
        directories: [alphaFolderPath, betaFolderPath]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Other/Beta.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Other/Beta',
        folderPath: betaFolderPath,
        kind: 'adopt',
        notePath: 'Other/Beta.md'
      }
    ]);
    expect(plan.rows).toContainEqual({
      externalFolder: 'Projects/Alpha',
      kind: 'blocked-note',
      message: `Descendant bound folder overlaps the derived external folder path: ${EXISTING_UUID}`,
      notePath: 'Projects/Alpha.md',
      reason: 'descendant-bound-folder'
    });
  });

  it('blocks overlapping malformed marker topology conflicts', () => {
    const alphaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const betaFolderPath = path.join(EXTERNAL_ROOT, 'Other', 'Beta');
    const malformedMarkerPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha', 'Child', '.exnf');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [alphaFolderPath, betaFolderPath],
        malformedMarkers: [
          {
            location: malformedMarkerPath,
            message: 'Invalid marker'
          }
        ]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Other/Beta.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Other/Beta',
        folderPath: betaFolderPath,
        kind: 'adopt',
        notePath: 'Other/Beta.md'
      }
    ]);
    expect(plan.rows).toContainEqual({
      externalFolder: 'Projects/Alpha',
      kind: 'blocked-note',
      message: `Descendant bound folder overlaps the derived external folder path: ${malformedMarkerPath}: Invalid marker`,
      notePath: 'Projects/Alpha.md',
      reason: 'descendant-bound-folder'
    });
  });

  it('blocks notes whose derived target is ignored', () => {
    const folderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [],
        ignoredDirectories: [
          {
            folderPath,
            relativePath: 'Projects/Alpha'
          }
        ],
        ignorePatterns: ['Projects/Alpha/']
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md'],
      vaultScan: buildVaultScan()
    });

    expect(getAdoptionRows(plan)).toEqual([]);
    expect(plan.rows).toEqual([
      {
        externalFolder: 'Projects/Alpha',
        kind: 'blocked-note',
        message: 'Derived external folder path is ignored by external root ignore patterns.',
        notePath: 'Projects/Alpha.md',
        reason: 'ignored-target'
      }
    ]);
    expect(plan.warnings).toEqual([
      'Ignored 1 external directory: Projects/Alpha'
    ]);
  });

  it('excludes all notes that already have duplicate vault identities', () => {
    const alphaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Alpha');
    const betaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Beta');
    const gammaFolderPath = path.join(EXTERNAL_ROOT, 'Projects', 'Gamma');
    const plan = buildAdoptionPlan({
      externalScan: buildExternalScan({
        directories: [alphaFolderPath, betaFolderPath, gammaFolderPath]
      }),
      mutationSequence: 0,
      notePaths: ['Projects/Alpha.md', 'Projects/Beta.md', 'Projects/Gamma.md'],
      vaultScan: buildVaultScan({
        bindings: new Map([[EXISTING_UUID, 'Projects/Alpha.md']]),
        duplicatePaths: new Map([[EXISTING_UUID, ['Projects/Alpha.md', 'Projects/Beta.md']]])
      })
    });

    expect(getAdoptionRows(plan)).toEqual([
      {
        externalFolder: 'Projects/Gamma',
        folderPath: gammaFolderPath,
        kind: 'adopt',
        notePath: 'Projects/Gamma.md'
      }
    ]);
    expect(plan.warnings).toContain(`Vault UUID ${EXISTING_UUID} is duplicated at: Projects/Alpha.md, Projects/Beta.md`);
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
    ignoredDirectories: [],
    ignoreErrors: [],
    ignorePatterns: [],
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
