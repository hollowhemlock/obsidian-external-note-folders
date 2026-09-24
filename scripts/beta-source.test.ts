import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
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

import type { GitHub } from './release-github.ts';

import { checkBetaSource } from './beta-source.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function fixture(): { api: GitHub; git: (...args: string[]) => string; root: string; writeMetadata: (version: string) => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'exnf-beta-'));
  roots.push(root);
  mkdirSync(path.join(root, '.github'));
  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  }
  function writeMetadata(version: string): void {
    const files = {
      '.github/.release-please-manifest.json': { '.': version },
      'manifest.json': { minAppVersion: '1.12.7', version },
      'package-lock.json': { packages: { '': { version } }, version },
      'package.json': { version },
      'versions.json': { [version]: '1.12.7' }
    };
    for (const [file, value] of Object.entries(files)) {
      writeFileSync(path.join(root, file), JSON.stringify(value) ?? 'null');
    }
  }
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  writeMetadata('2.0.0');
  git('add', 'package.json', 'package-lock.json', 'manifest.json', '.github/.release-please-manifest.json', 'versions.json');
  git('commit', '-m', 'chore: initial metadata');
  git('branch', 'dev');
  writeMetadata('2.1.0');
  git('add', 'package.json', 'package-lock.json', 'manifest.json', '.github/.release-please-manifest.json', 'versions.json');
  git('commit', '-m', 'chore: release 2.1.0');
  const sha = git('rev-parse', 'HEAD');
  const api: GitHub = {
    request<T>(route: string): Promise<T> {
      if (route.endsWith('/releases/latest')) {
        // eslint-disable-next-line camelcase -- GitHub API fixture.
        return Promise.resolve({ draft: false, prerelease: false, tag_name: 'external-note-folders-2.1.0' } as T);
      }
      if (route.includes('/commits/')) {
        return Promise.resolve({ sha } as T);
      }
      return Promise.resolve({ status: 'ahead' } as T);
    }
  };
  return { api, git, root, writeMetadata };
}

describe('beta source guard with actual Git history', () => {
  it('rejects consistent but stale metadata', async () => {
    const { api, git, root } = fixture();
    git('switch', 'dev');
    await expect(checkBetaSource(api, root, '2.2.0-beta.1')).rejects.toThrow('older than');
  });

  it('rejects copied current metadata without release ancestry', async () => {
    const { api, git, root, writeMetadata } = fixture();
    git('switch', 'dev');
    writeMetadata('2.1.0');
    await expect(checkBetaSource(api, root, '2.2.0-beta.1')).rejects.toThrow('must contain stable');
  });

  it('accepts release metadata and ancestry after a merge', async () => {
    const { api, git, root } = fixture();
    git('switch', 'dev');
    git('commit', '--allow-empty', '-m', 'ci: development work');
    git('merge', 'main', '-m', 'Merge stable into dev');
    expect(await checkBetaSource(api, root, '2.2.0-beta.1')).toContain('baseline: 2.1.0');
  });

  it('fails closed when latest stable cannot be resolved', async () => {
    const { root } = fixture();
    const api: GitHub = { request: () => Promise.reject(new Error('Release unavailable')) };
    await expect(checkBetaSource(api, root, '2.2.0-beta.1')).rejects.toThrow('Release unavailable');
  });
});
