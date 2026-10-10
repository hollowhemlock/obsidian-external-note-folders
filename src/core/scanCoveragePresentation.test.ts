import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildLeafReport } from './leafReport.ts';
import {
  coverageNotice,
  scanIssueCategory,
  scanProblemSummary
} from './scanCoveragePresentation.ts';

describe('status scan coverage presentation', () => {
  it('keeps expected exclusions and links informational and describes the actual scan mode', () => {
    const scan = auditFixture();
    scan.statusScanMode = 'filtered';
    scan.issues.push(
      {
        exclusionSource: 'git',
        kind: 'directory',
        location: `${scan.externalRoot}/vendor`,
        reason: 'Git rule .gitignore:2: vendor/',
        scope: 'external',
        unchecked: true
      },
      { kind: 'link', location: `${scan.externalRoot}/link`, reason: 'Not followed', scope: 'external', unchecked: true }
    );
    expect(scanProblemSummary(scan.issues)).toBe('');
    expect(coverageNotice(buildLeafReport(scan))).toContain('Ignored folders are skipped');
    scan.statusScanMode = 'unfiltered';
    scan.issues.shift();
    const notice = coverageNotice(buildLeafReport(scan));
    expect(notice).not.toContain('Ignored');
    expect(notice).toContain('Links are not followed');
    expect(notice).toContain('Additional .exnf markers');
    scan.issues = [];
    expect(coverageNotice(buildLeafReport(scan))).toBe('');
  });

  it('counts real problems separately and retains malformed marker findings as their own category', () => {
    const scan = auditFixture();
    scan.issues.push(
      { kind: 'directory', location: '/read', reason: 'Could not read', unchecked: true },
      { kind: 'note', location: '/note.md', reason: 'Invalid YAML', unchecked: true },
      { kind: 'marker', location: '/.exnf', reason: 'Could not read', unchecked: true },
      { kind: 'marker', location: '/not-a-uuid.exnf', reason: 'Malformed', unchecked: false },
      { code: 'git-repository-unavailable', exclusionSource: 'git', kind: 'directory', location: '/repo', reason: 'Skipped', unchecked: true }
    );
    expect(scan.issues.map(scanIssueCategory)).toEqual(['problems', 'problems', 'markers', 'markers', 'problems']);
    expect(scanProblemSummary(scan.issues)).toBe('1 unreadable directory · 1 unchecked note identity · 1 unchecked marker identity · 1 skipped repository');
    expect(coverageNotice(buildLeafReport(scan))).toContain('Some locations or identities could not be checked');
  });
});
