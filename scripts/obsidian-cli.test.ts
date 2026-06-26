import {
  describe,
  expect,
  it
} from 'vitest';

import type { ObsidianCliResult } from './obsidian-cli.ts';

import {
  isRuntimeUnavailable,
  isSupportedObsidianVersion,
  parseObsidianVersion
} from './obsidian-cli.ts';

function buildCliResult(overrides: Partial<ObsidianCliResult>): ObsidianCliResult {
  return {
    command: 'obsidian eval',
    errorMessage: '',
    status: 0,
    stderr: '',
    stdout: '',
    ...overrides
  };
}

describe('Obsidian CLI version support', () => {
  it('parses a semantic version from CLI output', () => {
    expect(parseObsidianVersion('Obsidian 1.12.7')).toEqual({
      major: 1,
      minor: 12,
      patch: 7,
      text: '1.12.7'
    });
  });

  it('prefers the Obsidian-labeled version over other reported versions', () => {
    expect(parseObsidianVersion('Installer 1.16.3\nObsidian 1.12.7')).toEqual({
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

describe('Obsidian CLI runtime availability', () => {
  it('detects an unavailable runtime from the CLI stderr', () => {
    expect(isRuntimeUnavailable(buildCliResult({
      status: 1,
      stderr: 'Error: unable to find Obsidian'
    }))).toBe(true);
  });

  it('detects an unavailable runtime reported through the spawn error', () => {
    expect(isRuntimeUnavailable(buildCliResult({
      errorMessage: 'unable to find Obsidian',
      status: null
    }))).toBe(true);
  });

  it('treats a successful runtime response as available', () => {
    expect(isRuntimeUnavailable(buildCliResult({ stdout: 'plugin:command' }))).toBe(false);
  });
});
