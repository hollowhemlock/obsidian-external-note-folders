import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { MovedFolderSuggestionReport } from './movedFolderSuggestions.ts';
import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import { buildExactPathCandidateIdentities } from './adoptionPlan.ts';
import { buildMovedFolderSuggestionReport } from './movedFolderSuggestions.ts';

const EXTERNAL_ROOT = path.resolve('external-root');

describe('buildMovedFolderSuggestionReport', () => {
  it('suggests a unique literal-name match at a divergent relative path', () => {
    const externalScan = buildExternalScan({
      directories: [
        path.join(EXTERNAL_ROOT, 'Old', 'Alpha')
      ]
    });
    const report = buildReport(['New/Alpha.md'], externalScan);

    expect(report.summary.uniqueSuggestions).toBe(1);
    expect(report.groups).toEqual([
      {
        groupPath: 'New',
        sampleSuggestions: [{
          candidateExternalFolder: 'Old/Alpha',
          expectedExternalFolder: 'New/Alpha',
          normalizedName: normalizeExpectedName('Alpha'),
          notePath: 'New/Alpha.md'
        }],
        suggestionCount: 1,
        suggestions: [{
          candidateExternalFolder: 'Old/Alpha',
          expectedExternalFolder: 'New/Alpha',
          normalizedName: normalizeExpectedName('Alpha'),
          notePath: 'New/Alpha.md'
        }]
      }
    ]);
    expect(report.markdownReport).toContain('read-only');
    expect(report.markdownReport).toContain('unique only among checked eligible paths');
  });

  it('excludes all exact candidate topology, including ancestors and descendants', () => {
    const exactFolder = path.join(EXTERNAL_ROOT, 'Exact', 'Alpha');
    const externalScan = buildExternalScan({
      directories: [
        path.join(EXTERNAL_ROOT, 'Exact'),
        exactFolder,
        path.join(exactFolder, 'Nested'),
        path.join(EXTERNAL_ROOT, 'Moved', 'Alpha')
      ]
    });
    const notePaths = ['Exact/Alpha.md', 'New/Alpha.md'];
    const exactCandidateIdentities = buildExactPathCandidateIdentities({
      externalScan,
      notePaths,
      vaultScan: buildVaultScan()
    });
    const report = buildMovedFolderSuggestionReport({
      exactCandidateIdentities,
      externalScan,
      notePaths,
      vaultScan: buildVaultScan()
    });

    expect(report.summary.uniqueSuggestions).toBe(1);
    expect(report.groups[0]?.suggestions[0]?.candidateExternalFolder).toBe('Moved/Alpha');
    expect(report.groups[0]?.suggestions[0]?.notePath).toBe('New/Alpha.md');
  });

  it('excludes existing identity, marker, malformed, skipped, and ignored topology', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const externalScan = buildExternalScan({
      bindings: new Map([[uuid, path.join(EXTERNAL_ROOT, 'Bound')]]),
      directories: [
        path.join(EXTERNAL_ROOT, 'Bound'),
        path.join(EXTERNAL_ROOT, 'Bound', 'Alpha'),
        path.join(EXTERNAL_ROOT, 'Malformed'),
        path.join(EXTERNAL_ROOT, 'Malformed', 'Alpha'),
        path.join(EXTERNAL_ROOT, 'Skipped'),
        path.join(EXTERNAL_ROOT, 'Skipped', 'Alpha'),
        path.join(EXTERNAL_ROOT, 'Safe', 'Alpha')
      ],
      ignoredDirectories: [{ folderPath: path.join(EXTERNAL_ROOT, 'Ignored'), relativePath: 'Ignored' }],
      malformedMarkers: [{ location: path.join(EXTERNAL_ROOT, 'Malformed', 'bad.exnf'), message: 'bad' }],
      skippedDirectories: [{ code: 'EPERM', location: path.join(EXTERNAL_ROOT, 'Skipped'), message: 'denied' }]
    });
    const report = buildReport(
      ['New/Alpha.md'],
      externalScan,
      buildVaultScan({
        bindings: new Map([['22222222-2222-4222-8222-222222222222', 'Reserved.md']])
      })
    );

    expect(report.groups[0]?.suggestions).toHaveLength(1);
    expect(report.groups[0]?.suggestions[0]?.candidateExternalFolder).toBe('Safe/Alpha');
    expect(report.notices.join(' ')).toContain('unchecked');
    expect(report.warnings).toHaveLength(1);
  });

  it('does not suggest a note whose exact target lies inside unchecked topology', () => {
    const externalScan = buildExternalScan({
      directories: [path.join(EXTERNAL_ROOT, 'Old', 'Alpha')],
      ignoredDirectories: [{
        folderPath: path.join(EXTERNAL_ROOT, 'Ignored'),
        relativePath: 'Ignored'
      }],
      skippedDirectories: [{
        code: 'EPERM',
        location: path.join(EXTERNAL_ROOT, 'Skipped'),
        message: 'denied'
      }]
    });
    const report = buildReport(
      ['Ignored/Alpha.md', 'Skipped/Alpha.md'],
      externalScan
    );

    expect(report.summary.uniqueSuggestions).toBe(0);
    expect(report.summary.ambiguousNames).toBe(0);
  });

  it('groups ambiguous names without creating note-folder cartesian rows', () => {
    const report = buildReport(
      ['New/Alpha.md', 'Other/Alpha.md'],
      buildExternalScan({
        directories: [
          path.join(EXTERNAL_ROOT, 'Old', 'Alpha'),
          path.join(EXTERNAL_ROOT, 'Archive', 'Alpha')
        ]
      })
    );

    expect(report.groups).toEqual([]);
    expect(report.ambiguityGroups).toEqual([{
      folderCount: 2,
      folderSamples: ['Archive/Alpha', 'Old/Alpha'],
      normalizedName: normalizeExpectedName('Alpha'),
      noteCount: 2,
      noteSamples: ['New/Alpha.md', 'Other/Alpha.md']
    }]);
  });

  it('uses literal names and does not equate sanitized punctuation', () => {
    const report = buildReport(
      ['New/A:B.md', 'New/Café.md'],
      buildExternalScan({
        directories: [
          path.join(EXTERNAL_ROOT, 'Old', 'A_B'),
          path.join(EXTERNAL_ROOT, 'Old', 'Cafe\u0301')
        ]
      })
    );

    expect(report.summary.uniqueSuggestions).toBe(1);
    expect(report.groups[0]?.suggestions[0]?.notePath).toBe('New/Café.md');
  });

  it('matches a folder note by its literal note basename', () => {
    const report = buildReport(
      ['New/Alpha/Alpha.md'],
      buildExternalScan({
        directories: [path.join(EXTERNAL_ROOT, 'Old', 'Alpha')]
      })
    );

    expect(report.groups[0]?.suggestions[0]).toMatchObject({
      candidateExternalFolder: 'Old/Alpha',
      expectedExternalFolder: 'New/Alpha',
      notePath: 'New/Alpha/Alpha.md'
    });
  });

  it('matches the literal note name even when expected-path derivation shortens it', () => {
    const longName = 'A'.repeat(40);
    const deepPath = Array.from({ length: 8 }, (_, index) => `Long-parent-${String(index)}-${'x'.repeat(20)}`).join('/');
    const notePath = `${deepPath}/${longName}.md`;
    const report = buildReport(
      [notePath],
      buildExternalScan({
        directories: [path.join(EXTERNAL_ROOT, 'Old', longName)]
      })
    );

    expect(report.summary.uniqueSuggestions).toBe(1);
    expect(report.groups[0]?.suggestions[0]?.candidateExternalFolder).toBe(`Old/${longName}`);
    expect(report.groups[0]?.suggestions[0]?.expectedExternalFolder).not.toBe(`${deepPath}/${longName}`);
  });

  it('omits classification after a root error', () => {
    const report = buildReport(
      ['New/Alpha.md'],
      buildExternalScan({
        accessErrors: [{ location: EXTERNAL_ROOT, message: 'missing' }],
        directories: [path.join(EXTERNAL_ROOT, 'Old', 'Alpha')]
      })
    );

    expect(report.classificationOmitted).toBe(true);
    expect(report.groups).toEqual([]);
    expect(report.summaryText).toContain('classification unavailable');
  });

  it('caps stable report samples while retaining all suggestions', () => {
    const notes = Array.from({ length: 205 }, (_, index) => `Group/Sub-${String(index).padStart(3, '0')}/Name-${String(index).padStart(3, '0')}.md`);
    const directories = notes.map((note, index) =>
      path.join(
        EXTERNAL_ROOT,
        'Old',
        `Branch-${String(index).padStart(3, '0')}`,
        path.basename(note, '.md')
      )
    );
    const report = buildReport(notes, buildExternalScan({ directories }));

    expect(report.summary.uniqueSuggestions).toBe(205);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.suggestions).toHaveLength(205);
    expect(report.markdownReport).not.toContain('Old/Branch-200/Name-200');
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

function buildReport(
  notePaths: readonly string[],
  externalScan: ExternalScanResult,
  vaultScan = buildVaultScan()
): MovedFolderSuggestionReport {
  return buildMovedFolderSuggestionReport({
    exactCandidateIdentities: buildExactPathCandidateIdentities({ externalScan, notePaths, vaultScan }),
    externalScan,
    notePaths,
    vaultScan
  });
}

function buildVaultScan(input: Partial<VaultScanResult> = {}): VaultScanResult {
  return {
    bindings: new Map(),
    duplicatePaths: new Map(),
    invalidFrontmatter: [],
    ...input
  };
}

function normalizeExpectedName(name: string): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? name.normalize('NFC').toLowerCase()
    : name.normalize('NFC');
}
