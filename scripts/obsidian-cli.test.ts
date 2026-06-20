import {
  describe,
  expect,
  it
} from 'vitest';

import {
  isSupportedObsidianVersion,
  parseObsidianVersion
} from './obsidian-cli.ts';

describe('Obsidian CLI version support', () => {
  it('parses a semantic version from CLI output', () => {
    expect(parseObsidianVersion('Obsidian 1.12.7')).toEqual({
      major: 1,
      minor: 12,
      patch: 7,
      text: '1.12.7'
    });
  });

  it('rejects versions older than 1.12.7', () => {
    const version = parseObsidianVersion('1.12.6');

    expect(version).not.toBeNull();
    expect(isSupportedObsidianVersion(version!)).toBe(false);
  });

  it('accepts version 1.12.7 and newer', () => {
    const minimumVersion = parseObsidianVersion('1.12.7');
    const newerMinorVersion = parseObsidianVersion('1.13.0');
    const newerMajorVersion = parseObsidianVersion('2.0.0');

    expect(isSupportedObsidianVersion(minimumVersion!)).toBe(true);
    expect(isSupportedObsidianVersion(newerMinorVersion!)).toBe(true);
    expect(isSupportedObsidianVersion(newerMajorVersion!)).toBe(true);
  });
});
