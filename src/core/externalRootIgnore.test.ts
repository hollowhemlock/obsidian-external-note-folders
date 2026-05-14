import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildExternalRootIgnoreMatcher,
  normalizeExternalRootIgnorePatterns
} from './externalRootIgnore.ts';

describe('external root ignore patterns', () => {
  it('normalizes backslashes before matching', () => {
    const matcher = buildExternalRootIgnoreMatcher(path.resolve('external-root'), ['Projects\\Ignored\\']);

    expect(matcher.patterns).toEqual(['Projects/Ignored/']);
    expect(matcher.ignoresRelativeDirectoryPath('Projects/Ignored')).toBe(true);
  });

  it('supports single-leading-slash root-anchored patterns', () => {
    const matcher = buildExternalRootIgnoreMatcher(path.resolve('external-root'), ['/Projects/Ignored/']);

    expect(matcher.errors).toEqual([]);
    expect(matcher.ignoresRelativeDirectoryPath('Projects/Ignored')).toBe(true);
    expect(matcher.ignoresRelativeDirectoryPath('Nested/Projects/Ignored')).toBe(false);
  });

  it('treats POSIX-looking single-leading-slash patterns as root-anchored relative patterns', () => {
    const matcher = buildExternalRootIgnoreMatcher(path.resolve('external-root'), ['/Users/ryanh/foo/']);

    expect(matcher.errors).toEqual([]);
    expect(matcher.ignoresRelativeDirectoryPath('Users/ryanh/foo')).toBe(true);
  });

  it('rejects Windows drive and UNC filesystem-absolute patterns', () => {
    expect(
      normalizeExternalRootIgnorePatterns([
        'C:/Users/ryanh/foo/',
        'C:\\Users\\ryanh\\foo\\',
        '//server/share/foo/',
        '\\\\server\\share\\foo\\'
      ]).errors.map((error) => error.pattern)
    ).toEqual([
      'C:/Users/ryanh/foo/',
      'C:/Users/ryanh/foo/',
      '//server/share/foo/',
      '//server/share/foo/'
    ]);
  });

  it('rejects negation patterns in v1', () => {
    expect(normalizeExternalRootIgnorePatterns(['!Projects/Ignored/']).errors).toEqual([
      {
        message: 'Negation patterns are not supported.',
        pattern: '!Projects/Ignored/'
      }
    ]);
  });

  it('matches directory-only patterns only when callers pass directory paths', () => {
    const matcher = buildExternalRootIgnoreMatcher(path.resolve('external-root'), ['Projects/Ignored/']);

    expect(matcher.ignoresRelativeDirectoryPath('Projects/Ignored')).toBe(true);
    expect(matcher.ignoresRelativeDirectoryPath('Projects/Ignored/File.md')).toBe(true);
  });

  it('can match with platform-aware case insensitivity', () => {
    const insensitiveMatcher = buildExternalRootIgnoreMatcher(
      path.resolve('external-root'),
      ['Projects/Ignored/'],
      { ignoreCase: true }
    );
    const sensitiveMatcher = buildExternalRootIgnoreMatcher(
      path.resolve('external-root'),
      ['Projects/Ignored/'],
      { ignoreCase: false }
    );

    expect(insensitiveMatcher.ignoresRelativeDirectoryPath('projects/ignored')).toBe(true);
    expect(sensitiveMatcher.ignoresRelativeDirectoryPath('projects/ignored')).toBe(false);
  });
});
