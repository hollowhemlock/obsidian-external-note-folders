import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  checkMetadata,
  compareStable,
  requireBetaVersion
} from './release-metadata.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'exnf-release-'));
  roots.push(root);
  mkdirSync(path.join(root, '.github'));
  const files = {
    '.github/.release-please-manifest.json': { '.': '2.1.0' },
    'manifest.json': { minAppVersion: '1.12.7', version: '2.1.0' },
    'package-lock.json': { packages: { '': { version: '2.1.0' } }, version: '2.1.0' },
    'package.json': { version: '2.1.0' },
    'versions.json': { '2.1.0': '1.12.7' }
  };
  for (const [file, value] of Object.entries(files)) {
    writeFileSync(path.join(root, file), JSON.stringify(value) ?? 'null');
  }
  return root;
}

describe('release metadata', () => {
  it('checks agreement without writing any files', () => {
    const root = fixture();
    const before = readFileSync(path.join(root, 'manifest.json'), 'utf8');
    expect(checkMetadata(root)).toEqual({ minAppVersion: '1.12.7', version: '2.1.0' });
    expect(readFileSync(path.join(root, 'manifest.json'), 'utf8')).toBe(before);
  });

  it.each([
    ['package.json', { version: '2.0.0' }],
    ['package-lock.json', { packages: { '': { version: '2.1.0' } }, version: '2.0.0' }],
    ['package-lock.json', { packages: { '': { version: '2.0.0' } }, version: '2.1.0' }],
    ['.github/.release-please-manifest.json', { '.': '2.0.0' }],
    ['versions.json', { '2.1.0': '1.0.0' }],
    ['manifest.json', { minAppVersion: '1.12.7', version: '02.1.0' }]
  ])('rejects drift in %s', (file, value) => {
    const root = fixture();
    writeFileSync(path.join(root, file), JSON.stringify(value));
    expect(() => checkMetadata(root)).toThrow();
  });

  it('rejects malformed JSON', () => {
    const root = fixture();
    writeFileSync(path.join(root, 'package.json'), '{broken');
    expect(() => checkMetadata(root)).toThrow();
  });

  it('compares numeric version components, including large components', () => {
    expect(compareStable('2.10.0', '2.9.0')).toBe(1);
    expect(compareStable('2.1.0', '2.1.0')).toBe(0);
    expect(compareStable('2.0.0', '2.1.0')).toBe(-1);
    expect(compareStable('999999999999999999999.0.0', '999999999999999999998.0.0')).toBe(1);
  });

  it.each(['2.1.0-beta.1', '2.0.9-beta.1', '2.2.0', '02.2.0-beta.1', '2.2.0-beta.01', '2.2.0-beta..1'])('rejects invalid or older beta %s', (beta) => {
    expect(() => {
      requireBetaVersion(beta, '2.1.0');
    }).toThrow();
  });

  it.each(['2.1.1-beta.0', '2.2.0-beta.1', '3.0.0-rc.1+build.001'])('accepts newer semantic prerelease %s', (beta) => {
    expect(() => {
      requireBetaVersion(beta, '2.1.0');
    }).not.toThrow();
  });
});
