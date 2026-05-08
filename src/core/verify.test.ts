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

import { buildVerifyReport } from './verify.ts';

const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';
const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('verify report builder', () => {
  it('classifies ok, unavailable, warning, and error states', () => {
    const vaultScan: VaultScanResult = {
      bindings: new Map([
        ['123e4567-e89b-42d3-a456-426614174001', 'Notes/Beta.md'],
        [VALID_UUID, 'Notes/Alpha.md']
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
        ['123e4567-e89b-42d3-a456-426614174999', 'X:\\External\\Orphan'],
        [VALID_UUID, 'X:\\External\\Notes\\Alpha']
      ]),
      directories: [
        'X:\\External\\Notes',
        'X:\\External\\Notes\\Alpha',
        'X:\\External\\Orphan'
      ],
      duplicatePaths: new Map(),
      malformedMarkers: [],
      rootPath: 'X:\\External',
      skippedDirectories: []
    };

    const report = buildVerifyReport(vaultScan, externalScan);

    expect(report.errors).toEqual([
      'Invalid frontmatter at Notes/Gamma.md: must be a canonical lowercase UUID.'
    ]);
    expect(report.ok).toEqual(['Notes/Alpha.md -> X:\\External\\Notes\\Alpha']);
    expect(report.okRows).toEqual([
      {
        externalFolder: 'Notes/Alpha',
        notePath: 'Notes/Alpha.md',
        uuid: VALID_UUID
      }
    ]);
    expect(report.unavailable).toEqual([
      'Notes/Beta.md (123e4567-e89b-42d3-a456-426614174001) has no bound external folder.'
    ]);
    expect(report.unavailableRows).toEqual([
      {
        externalFolder: null,
        notePath: 'Notes/Beta.md',
        uuid: '123e4567-e89b-42d3-a456-426614174001'
      }
    ]);
    expect(report.warnings).toEqual([]);
    expect(report.warningRows).toEqual([
      {
        externalFolder: 'Orphan',
        notePath: null,
        uuid: '123e4567-e89b-42d3-a456-426614174999'
      }
    ]);
    expect(report.markdownReport).toContain('# External Folder Verify Report');
    expect(report.markdownReport).toContain('| Vault file | External folder | UUID |');
    expect(report.markdownReport).toContain('| Notes/Alpha.md | Notes/Alpha | 123e4567-e89b-42d3-a456-426614174000 |');
    expect(report.markdownReport).toContain('| - | Orphan | 123e4567-e89b-42d3-a456-426614174999 |');
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
      directories: [],
      duplicatePaths: new Map(),
      malformedMarkers: [],
      rootPath: 'X:\\External',
      skippedDirectories: []
    };

    const report = buildVerifyReport(vaultScan, externalScan);

    expect(report.classificationOmitted).toBe(true);
    expect(report.ok).toEqual([]);
    expect(report.okRows).toEqual([]);
    expect(report.unavailable).toEqual([]);
    expect(report.unavailableRows).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.warningRows).toEqual([]);
    expect(report.errors).toEqual([
      'External root access error at X:\\External: External root is not configured.'
    ]);
    expect(report.markdownReport).toContain('External root access error at X:\\External: External root is not configured.');
  });

  it('reports skipped descendant directories as non-blocking warnings', () => {
    const vaultScan: VaultScanResult = {
      bindings: new Map([[VALID_UUID, 'Notes/Alpha.md']]),
      duplicatePaths: new Map(),
      invalidFrontmatter: []
    };
    const externalScan: ExternalScanResult = {
      accessErrors: [],
      bindings: new Map([[VALID_UUID, 'X:\\External\\Notes\\Alpha']]),
      directories: ['X:\\External\\Notes', 'X:\\External\\Notes\\Alpha', 'X:\\External\\Unreadable'],
      duplicatePaths: new Map(),
      malformedMarkers: [],
      rootPath: 'X:\\External',
      skippedDirectories: [
        {
          location: 'X:\\External\\Unreadable',
          message: 'permission denied'
        }
      ]
    };

    const report = buildVerifyReport(vaultScan, externalScan);

    expect(report.hasIntegrityErrors).toBe(false);
    expect(report.classificationOmitted).toBe(false);
    expect(report.warnings).toEqual([
      'Skipped external directory at X:\\External\\Unreadable: permission denied'
    ]);
    expect(report.okRows).toEqual([
      {
        externalFolder: 'Notes/Alpha',
        notePath: 'Notes/Alpha.md',
        uuid: VALID_UUID
      }
    ]);
  });

  it('reports notes that derive to the same external folder path as an integrity error', () => {
    const externalRootPath = path.resolve('external-root');
    const vaultScan: VaultScanResult = {
      bindings: new Map([
        [OTHER_UUID, 'Projects/Alpha/Alpha.md'],
        [VALID_UUID, 'Projects/Alpha.md']
      ]),
      duplicatePaths: new Map(),
      invalidFrontmatter: []
    };
    const externalScan: ExternalScanResult = {
      accessErrors: [],
      bindings: new Map(),
      directories: [],
      duplicatePaths: new Map(),
      malformedMarkers: [],
      rootPath: externalRootPath,
      skippedDirectories: []
    };

    const report = buildVerifyReport(vaultScan, externalScan);

    expect(report.hasIntegrityErrors).toBe(true);
    expect(report.errors).toEqual([
      'Derived external folder path Projects/Alpha is shared by multiple notes: Projects/Alpha.md, Projects/Alpha/Alpha.md'
    ]);
  });
});
