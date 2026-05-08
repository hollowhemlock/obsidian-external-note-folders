import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  assertPathIsWithinRoot,
  deriveExternalFolderPath,
  deriveExternalFolderRelativeSegments,
  normalizePathForIdentity,
  sanitizePathComponent
} from './pathPolicy.ts';

describe('path policy', () => {
  it('derives a vault-relative external folder path without the markdown extension', () => {
    expect(deriveExternalFolderRelativeSegments('Projects/Research/My Note.md')).toEqual([
      'Projects',
      'Research',
      'My Note'
    ]);
  });

  it('collapses folder-note paths when the note stem matches its parent folder', () => {
    expect(
      deriveExternalFolderRelativeSegments('Projects/2025-08-04_wood storage cart/2025-08-04_wood storage cart.md')
    ).toEqual([
      'Projects',
      '2025-08-04_wood storage cart'
    ]);
  });

  it('sanitizes invalid Windows path characters and reserved names', () => {
    expect(sanitizePathComponent('con:report*')).toBe('con_report_');
    expect(sanitizePathComponent('Ends with dots...   ')).toBe('Ends with dots');
  });

  it('derives a target path under the configured external root', () => {
    const derivedPath = deriveExternalFolderPath(
      'Projects/Research/My Note.md',
      path.resolve('X:/ExternalRoot')
    );

    expect(derivedPath).toBe(path.resolve('X:/ExternalRoot', 'Projects', 'Research', 'My Note'));
  });

  it('derives folder-note targets to the parent folder instead of a duplicate child folder', () => {
    const derivedPath = deriveExternalFolderPath(
      '0_unsorted/2025-08-04_wood storage cart/2025-08-04_wood storage cart.md',
      path.resolve('X:/ExternalRoot')
    );

    expect(derivedPath).toBe(
      path.resolve('X:/ExternalRoot', '0_unsorted', '2025-08-04_wood storage cart')
    );
  });

  it('shortens overly long paths deterministically', () => {
    const externalRootPath = path.join(path.parse(process.cwd()).root, 'ExternalRoot');
    const derivedPath = deriveExternalFolderPath(
      `Projects/${'A'.repeat(120)}.md`,
      externalRootPath,
      60
    );

    expect(derivedPath.length).toBeLessThanOrEqual(60);
    expect(derivedPath).toMatch(/~[0-9a-f]{8}$/u);
  });

  it('rejects candidate paths that escape the configured root', () => {
    expect(() => {
      assertPathIsWithinRoot(path.resolve('X:/ExternalRoot'), path.resolve('X:/'));
    }).toThrow('escapes the configured root');
  });

  it('normalizes paths for identity comparisons', () => {
    const upper = normalizePathForIdentity('X:/ExternalRoot/Folder');
    const lower = normalizePathForIdentity('x:/externalroot/folder');

    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(upper).toBe(lower);
      return;
    }

    expect(upper).not.toBe(lower);
  });
});
