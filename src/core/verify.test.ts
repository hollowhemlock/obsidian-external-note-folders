import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildVerifyReport,
  type ExternalScanResult,
  type VaultScanResult
} from './verify.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('verify report builder', () => {
  it('classifies ok, unavailable, warning, and error states', () => {
    const vaultScan: VaultScanResult = {
      bindings: new Map([
        [VALID_UUID, 'Notes/Alpha.md'],
        ['123e4567-e89b-42d3-a456-426614174001', 'Notes/Beta.md']
      ]),
      duplicatePaths: new Map(),
      invalidFrontmatter: [
        {
          location: 'Notes/Gamma.md',
          message: 'must be a canonical lowercase UUID.'
        }
      ]
    };
    const externalScan: ExternalScanResult = {
      accessErrors: [],
      bindings: new Map([
        [VALID_UUID, 'X:\\External\\Notes\\Alpha'],
        ['123e4567-e89b-42d3-a456-426614174999', 'X:\\External\\Orphan']
      ]),
      duplicatePaths: new Map(),
      malformedMarkers: [],
      rootPath: 'X:\\External'
    };

    const report = buildVerifyReport(vaultScan, externalScan);

    expect(report.errors).toEqual([
      'Invalid frontmatter at Notes/Gamma.md: must be a canonical lowercase UUID.'
    ]);
    expect(report.ok).toEqual(['Notes/Alpha.md -> X:\\External\\Notes\\Alpha']);
    expect(report.unavailable).toEqual([
      'Notes/Beta.md (123e4567-e89b-42d3-a456-426614174001) has no bound external folder.'
    ]);
    expect(report.warnings).toEqual([
      'X:\\External\\Orphan (123e4567-e89b-42d3-a456-426614174999) is orphaned.'
    ]);
  });

  it('omits availability classification when access errors exist', () => {
    const vaultScan: VaultScanResult = {
      bindings: new Map([[VALID_UUID, 'Notes/Alpha.md']]),
      duplicatePaths: new Map(),
      invalidFrontmatter: []
    };
    const externalScan: ExternalScanResult = {
      accessErrors: [
        {
          location: 'X:\\External',
          message: 'External root is not configured.'
        }
      ],
      bindings: new Map(),
      duplicatePaths: new Map(),
      malformedMarkers: [],
      rootPath: 'X:\\External'
    };

    const report = buildVerifyReport(vaultScan, externalScan);

    expect(report.classificationOmitted).toBe(true);
    expect(report.ok).toEqual([]);
    expect(report.unavailable).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.errors).toEqual([
      'External root access error at X:\\External: External root is not configured.'
    ]);
  });
});
