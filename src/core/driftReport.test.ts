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

import { buildDriftReport } from './driftReport.ts';

const EXPECTED_UUID = '123e4567-e89b-42d3-a456-426614174000';
const MISSING_UUID = '123e4567-e89b-42d3-a456-426614174001';
const RENAMED_UUID = '123e4567-e89b-42d3-a456-426614174002';
const OCCUPIED_UUID = '123e4567-e89b-42d3-a456-426614174003';
const UNMARKED_OCCUPIED_UUID = '123e4567-e89b-42d3-a456-426614174004';
const DIFFERENT_UUID = '123e4567-e89b-42d3-a456-426614174998';
const ORPHAN_UUID = '123e4567-e89b-42d3-a456-426614174999';

describe('drift report builder', () => {
  it('classifies expected, unexpected, missing, orphaned, and occupied folders', () => {
    const externalRootPath = path.resolve('external-root');
    const vaultScan: VaultScanResult = {
      bindings: new Map([
        [EXPECTED_UUID, 'Notes/Alpha.md'],
        [MISSING_UUID, 'Notes/Missing.md'],
        [OCCUPIED_UUID, 'Notes/Occupied.md'],
        [RENAMED_UUID, 'Notes/Renamed.md'],
        [UNMARKED_OCCUPIED_UUID, 'Notes/Unmarked Occupied.md']
      ]),
      duplicatePaths: new Map(),
      invalidFrontmatter: []
    };
    const externalScan: ExternalScanResult = {
      accessErrors: [],
      bindings: new Map([
        [DIFFERENT_UUID, path.join(externalRootPath, 'Notes', 'Occupied')],
        [EXPECTED_UUID, path.join(externalRootPath, 'Notes', 'Alpha')],
        [ORPHAN_UUID, path.join(externalRootPath, 'Archive', 'Orphan')],
        [RENAMED_UUID, path.join(externalRootPath, 'Notes', 'Old Name')]
      ]),
      directories: [
        path.join(externalRootPath, 'Archive'),
        path.join(externalRootPath, 'Archive', 'Orphan'),
        path.join(externalRootPath, 'Notes'),
        path.join(externalRootPath, 'Notes', 'Alpha'),
        path.join(externalRootPath, 'Notes', 'Missing Candidate'),
        path.join(externalRootPath, 'Notes', 'Occupied'),
        path.join(externalRootPath, 'Notes', 'Old Name'),
        path.join(externalRootPath, 'Notes', 'Unmarked Occupied')
      ],
      duplicatePaths: new Map(),
      ignoredDirectories: [],
      ignoreErrors: [],
      ignorePatterns: [],
      malformedMarkers: [],
      rootPath: externalRootPath,
      skippedDirectories: []
    };

    const report = buildDriftReport(vaultScan, externalScan);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.expectedRows).toEqual([
      {
        actualExternalFolder: 'Notes/Alpha',
        expectedExternalFolder: 'Notes/Alpha',
        notePath: 'Notes/Alpha.md',
        uuid: EXPECTED_UUID
      }
    ]);
    expect(report.unexpectedRows).toEqual([
      {
        actualExternalFolder: 'Notes/Old Name',
        expectedExternalFolder: 'Notes/Renamed',
        notePath: 'Notes/Renamed.md',
        uuid: RENAMED_UUID
      }
    ]);
    expect(report.missingRows).toHaveLength(3);
    expect(report.orphanRows).toEqual([
      {
        actualExternalFolder: 'Archive/Orphan',
        expectedExternalFolder: null,
        notePath: null,
        uuid: ORPHAN_UUID
      },
      {
        actualExternalFolder: 'Notes/Occupied',
        expectedExternalFolder: null,
        notePath: null,
        uuid: DIFFERENT_UUID
      }
    ]);
    expect(report.occupiedRows).toEqual([
      {
        expectedExternalFolder: 'Notes/Occupied',
        notePath: 'Notes/Occupied.md',
        reason: `Bound to different UUID: ${DIFFERENT_UUID}`,
        uuid: OCCUPIED_UUID
      },
      {
        expectedExternalFolder: 'Notes/Unmarked Occupied',
        notePath: 'Notes/Unmarked Occupied.md',
        reason: 'Unmarked folder occupies expected path.',
        uuid: UNMARKED_OCCUPIED_UUID
      }
    ]);
    expect(report.suggestions).toContainEqual({
      candidateExternalFolder: 'Notes/Old Name',
      confidence: 'high',
      expectedExternalFolder: 'Notes/Renamed',
      notePath: 'Notes/Renamed.md',
      rationale: 'Same UUID is bound at a non-expected path.',
      uuid: RENAMED_UUID
    });
    expect(report.markdownReport).toContain('# External Folder Drift Report');
  });

  it('reports integrity errors without classifying drift when external access fails', () => {
    const report = buildDriftReport(
      {
        bindings: new Map([[EXPECTED_UUID, 'Notes/Alpha.md']]),
        duplicatePaths: new Map(),
        invalidFrontmatter: []
      },
      {
        accessErrors: [
          {
            location: '(settings)',
            message: 'External root is not configured.'
          }
        ],
        bindings: new Map(),
        directories: [],
        duplicatePaths: new Map(),
        ignoredDirectories: [],
        ignoreErrors: [],
        ignorePatterns: [],
        malformedMarkers: [],
        rootPath: '',
        skippedDirectories: []
      }
    );

    expect(report.errors).toEqual([
      'External root access error at (settings): External root is not configured.'
    ]);
    expect(report.missingRows).toEqual([]);
    expect(report.suggestions).toEqual([]);
  });

  it('includes skipped descendant directories as warnings without suppressing drift classification', () => {
    const externalRootPath = path.resolve('external-root');
    const report = buildDriftReport(
      {
        bindings: new Map([[EXPECTED_UUID, 'Notes/Alpha.md']]),
        duplicatePaths: new Map(),
        invalidFrontmatter: []
      },
      {
        accessErrors: [],
        bindings: new Map([[EXPECTED_UUID, path.join(externalRootPath, 'Notes', 'Alpha')]]),
        directories: [
          path.join(externalRootPath, 'Notes'),
          path.join(externalRootPath, 'Notes', 'Alpha'),
          path.join(externalRootPath, 'Unreadable')
        ],
        duplicatePaths: new Map(),
        ignoredDirectories: [],
        ignoreErrors: [],
        ignorePatterns: [],
        malformedMarkers: [],
        rootPath: externalRootPath,
        skippedDirectories: [
          {
            location: path.join(externalRootPath, 'Unreadable'),
            message: 'permission denied'
          }
        ]
      }
    );

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([
      `Skipped external directory at ${path.join(externalRootPath, 'Unreadable')}: permission denied`
    ]);
    expect(report.expectedRows).toHaveLength(1);
    expect(report.markdownReport).toContain('## Warnings');
  });

  it('reports ignored linked folders as ignored instead of missing or healthy', () => {
    const externalRootPath = path.resolve('external-root');
    const externalFolderPath = path.join(externalRootPath, 'Notes', 'Alpha');
    const report = buildDriftReport(
      {
        bindings: new Map([[EXPECTED_UUID, 'Notes/Alpha.md']]),
        duplicatePaths: new Map(),
        invalidFrontmatter: []
      },
      {
        accessErrors: [],
        bindings: new Map(),
        directories: [],
        duplicatePaths: new Map(),
        ignoredDirectories: [
          {
            folderPath: externalFolderPath,
            relativePath: 'Notes/Alpha'
          }
        ],
        ignoreErrors: [],
        ignorePatterns: ['Notes/Alpha/'],
        malformedMarkers: [],
        rootPath: externalRootPath,
        skippedDirectories: []
      }
    );

    expect(report.ignoredRows).toEqual([
      {
        actualExternalFolder: null,
        expectedExternalFolder: 'Notes/Alpha',
        notePath: 'Notes/Alpha.md',
        uuid: EXPECTED_UUID
      }
    ]);
    expect(report.expectedRows).toEqual([]);
    expect(report.missingRows).toEqual([]);
  });
});
