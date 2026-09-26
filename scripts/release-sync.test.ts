/* eslint-disable camelcase -- Fixtures mirror GitHub API payloads. */
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  GitHub,
  Release
} from './release-github.ts';

import { synchronizeRelease } from './release-sync.ts';

function harness(options: {
  actorLogin?: string;
  assetsMissing?: boolean;
  changedDev?: boolean;
  changedRelease?: boolean;
  clean?: boolean;
  conflict?: boolean;
  existing?: boolean;
  foreign?: boolean;
  foreignAuthor?: boolean;
  graphqlError?: boolean;
  identityError?: boolean;
  manifestMismatch?: boolean;
  older?: boolean;
  synced?: boolean;
  unprotected?: boolean;
} = {}): { api: GitHub; calls: { body?: Record<string, unknown>; route: string }[] } {
  const calls: { body?: Record<string, unknown>; route: string }[] = [];
  const release: Release = {
    assets: (options.assetsMissing ? ['manifest.json'] : ['main.js', 'styles.css', 'manifest.json'])
      .map((name, id) => ({ id, name, size: 100, state: 'uploaded' })),
    draft: false,
    prerelease: false,
    tag_name: 'external-note-folders-2.1.0'
  };
  const manifest = { id: 'external-note-folders', minAppVersion: '1.12.7', version: '2.1.0' };
  const pr = {
    base: { ref: 'dev' },
    body: options.foreign ? 'Unrelated PR' : '<!-- release-sync:v1 -->',
    head: { ref: 'release-sync/2.1.0', repo: { full_name: 'owner/repo' }, sha: 'merged' },
    html_url: 'https://github.com/owner/repo/pull/42',
    node_id: 'PR_42',
    number: 42,
    state: 'open',
    user: { login: options.foreignAuthor ? 'another-author' : options.actorLogin ?? 'bot' }
  };
  if (options.clean) {
    Object.assign(pr, { mergeable_state: 'clean' });
  }
  let latestReads = 0;
  let devReads = 0;
  const api: GitHub = {
    // eslint-disable-next-line complexity -- Explicit mock routes make unexpected API writes fail the test.
    request<T>(route: string, body?: Record<string, unknown>): Promise<T> {
      calls.push({ route, ...(body ? { body } : {}) });
      let result: unknown;
      if (route === 'GET /repos/{repo}/releases/latest') {
        latestReads++;
        result = options.changedRelease && latestReads > 1 ? { ...release, tag_name: 'external-note-folders-2.2.0' } : release;
      } else if (route.includes('/releases/tags/')) {
        result = release;
      } else if (route.includes('/releases/assets/')) {
        result = options.manifestMismatch ? { ...manifest, version: '2.0.0' } : manifest;
      } else if (route.includes('/commits/')) {
        result = { sha: 'stable' };
      } else if (route.includes('/contents/')) {
        result = { content: Buffer.from(JSON.stringify(manifest)).toString('base64') };
      } else if (route.includes('/compare/')) {
        result = { status: route.endsWith('...dev') && !options.synced ? 'diverged' : 'ahead' };
      } else if (route === 'GET /repos/{repo}/git/ref/heads/dev') {
        devReads++;
        result = { object: { sha: options.changedDev && devReads > 1 ? 'newdev' : 'dev' } };
      } else if (route === 'POST /graphql' && body?.['query'] === 'query ReleaseSyncActor { viewer { login } }') {
        result = options.identityError
          ? { errors: [{ message: 'Cannot resolve identity' }] }
          : { data: { viewer: { login: options.actorLogin ?? 'bot' } } };
      } else if (route.includes('pulls?state=all')) {
        result = options.existing ? [pr] : [];
      } else if (route.includes('matching-refs')) {
        result = options.existing ? [{ ref: 'refs/heads/release-sync/2.1.0' }] : [];
      } else if (route.includes('/git/ref/heads/release-sync/')) {
        result = { object: { sha: options.existing ? 'merged' : 'stable' } };
      } else if (route === 'POST /repos/{repo}/pulls' || route === 'GET /repos/{repo}/pulls/42') {
        result = pr;
      } else if (route === 'POST /repos/{repo}/merges') {
        if (options.conflict) {
          return Promise.reject(new Error('HTTP 409 merge conflict'));
        }
        result = { sha: 'merged' };
      } else if (route === 'GET /repos/{repo}') {
        result = { allow_auto_merge: true, allow_merge_commit: true };
      } else if (route.endsWith('/protection')) {
        result = options.unprotected
          ? {}
          : {
            enforce_admins: { enabled: true },
            required_conversation_resolution: { enabled: true },
            required_pull_request_reviews: { required_approving_review_count: 0 },
            required_status_checks: { contexts: ['validate', 'conventional-commits'], strict: true }
          };
      } else if (route === 'POST /graphql') {
        result = options.graphqlError ? { errors: [{ message: 'Denied' }] } : { data: {} };
      } else if (route === 'PUT /repos/{repo}/pulls/42/merge') {
        result = { merged: true };
      } else if (route.includes('pulls?state=open')) {
        result = options.older
          ? [pr, { ...pr, head: { ...pr.head, ref: 'release-sync/2.0.0' }, number: 41 }, { ...pr, body: 'Unrelated PR', number: 40 }]
          : [pr];
      } else if (route !== 'POST /repos/{repo}/git/refs' && route !== 'PATCH /repos/{repo}/pulls/41') {
        return Promise.reject(new Error(`Unexpected route ${route}`));
      }
      return Promise.resolve(result as T);
    }
  };
  return { api, calls };
}

describe('release synchronization', () => {
  it.each(['release-maintainer', 'release-app[bot]'])('uses authenticated identity %s to create and maintain owned PRs', async (actorLogin) => {
    for (const existing of [false, true]) {
      const { api, calls } = harness({ actorLogin, existing });
      expect(await synchronizeRelease(api, 'owner/repo')).toContain('Auto-merge requested');
      expect(calls.some((call) => call.route === 'GET /user')).toBe(false);
      expect(calls.some(isAutoMergeCall)).toBe(true);
    }
  });

  it.each(['release-maintainer', 'release-app[bot]'])('rejects another PR author when authenticated as %s', async (actorLogin) => {
    const { api, calls } = harness({ actorLogin, existing: true, foreignAuthor: true });
    await expect(synchronizeRelease(api, 'owner/repo')).rejects.toThrow('not owned');
    expect(calls.some((call) => call.route === 'POST /repos/{repo}/merges')).toBe(false);
    expect(calls.some(isAutoMergeCall)).toBe(false);
  });

  it('does not write repository state when the authenticated identity cannot be verified', async () => {
    const { api, calls } = harness({ identityError: true });
    await expect(synchronizeRelease(api, 'owner/repo')).rejects.toThrow('authenticated');
    expect(calls.some((call) => !call.route.startsWith('GET') && call.body?.['query'] !== 'query ReleaseSyncActor { viewer { login } }')).toBe(false);
  });

  it('merges an already passing PR using its exact head and normal protections', async () => {
    const { api, calls } = harness({ clean: true });
    await synchronizeRelease(api, 'owner/repo');
    expect(calls.find((call) => call.route === 'PUT /repos/{repo}/pulls/42/merge')?.body).toEqual({ merge_method: 'merge', sha: 'merged' });
    expect(calls.some(isAutoMergeCall)).toBe(false);
  });

  it('closes only older owned PRs after enabling the replacement', async () => {
    const { api, calls } = harness({ older: true });
    await synchronizeRelease(api, 'owner/repo');
    const closed = calls.filter((call) => call.route.startsWith('PATCH'));
    expect(closed.map((call) => call.route)).toEqual(['PATCH /repos/{repo}/pulls/41']);
    expect(calls.indexOf(closed[0]!)).toBeGreaterThan(calls.findIndex(isAutoMergeCall));
  });

  it('opens a merge-based PR only after verifying assets and enforcing protection', async () => {
    const { api, calls } = harness();
    expect(await synchronizeRelease(api, 'owner/repo', 'external-note-folders-2.1.0')).toContain('Auto-merge requested');
    expect(calls.find((call) => call.route.endsWith('/git/refs'))?.body).toEqual({ ref: 'refs/heads/release-sync/2.1.0', sha: 'stable' });
    expect(calls.find(isAutoMergeCall)?.body?.['query']).toContain('mergeMethod:MERGE');
    expect(calls.some((call) => call.route.includes('DELETE'))).toBe(false);
  });

  it('reuses an existing owned PR without creating another branch or PR', async () => {
    const { api, calls } = harness({ existing: true });
    await synchronizeRelease(api, 'owner/repo');
    expect(calls.some((call) => call.route === 'POST /repos/{repo}/pulls' || call.route === 'POST /repos/{repo}/git/refs')).toBe(false);
  });

  it('does not replace an older publication callback with latest stable', async () => {
    const { api, calls } = harness();
    expect(await synchronizeRelease(api, 'owner/repo', 'external-note-folders-2.0.0')).toContain('Skipped');
    expect(calls).toHaveLength(1);
  });

  it('does nothing when dev already contains the stable release', async () => {
    const { api, calls } = harness({ synced: true });
    expect(await synchronizeRelease(api, 'owner/repo')).toContain('already contains');
    expect(calls.every((call) => call.route.startsWith('GET'))).toBe(true);
  });

  it.each([
    { assetsMissing: true },
    { manifestMismatch: true },
    { conflict: true },
    { changedDev: true },
    { changedRelease: true },
    { unprotected: true },
    { existing: true, foreign: true }
  ])('blocks auto-merge on unsafe or incomplete state %j', async (options) => {
    const { api, calls } = harness(options);
    await expect(synchronizeRelease(api, 'owner/repo')).rejects.toThrow();
    expect(calls.some(isAutoMergeCall)).toBe(false);
  });

  it('surfaces permission and GraphQL failures instead of claiming success', async () => {
    const { api } = harness({ graphqlError: true });
    await expect(synchronizeRelease(api, 'owner/repo')).rejects.toThrow('Could not enable');
    await expect(synchronizeRelease({ request: () => Promise.reject(new Error('HTTP 403')) }, 'owner/repo')).rejects.toThrow('403');
  });
});

function isAutoMergeCall(call: { body?: Record<string, unknown>; route: string }): boolean {
  return call.route === 'POST /graphql' && String(call.body?.['query']).includes('enablePullRequestAutoMerge');
}
/* eslint-enable camelcase -- End of GitHub API fixtures. */
