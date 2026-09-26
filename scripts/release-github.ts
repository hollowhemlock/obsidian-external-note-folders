import { appendFileSync } from 'node:fs';

import { stableVersion } from './release-metadata.ts';

export interface GitHub {
  request<T>(route: string, body?: Record<string, unknown>, accept?: string): Promise<T>;
}

export interface Release {
  assets: { id: number; name: string; size: number; state: string }[];
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
}

export async function authenticatedActor(api: GitHub): Promise<{ login: string }> {
  // Unlike REST /user, GraphQL viewer also resolves GitHub App installation identities.
  const result = await api.request<
    {
      data?: { viewer?: { login?: unknown } | null } | null;
      errors?: unknown[];
    } | null
  >('POST /graphql', { query: 'query ReleaseSyncActor { viewer { login } }' });
  const login = result?.data?.viewer?.login;
  if (result?.errors?.length || typeof login !== 'string' || login.trim() === '' || login !== login.trim()) {
    throw new Error('Could not verify the authenticated GitHub user or App bot. Check token permissions and rerun synchronization.');
  }
  return { login };
}

export function githubClient(): GitHub {
  const token = process.env['GH_TOKEN'];
  const repository = process.env['GITHUB_REPOSITORY'];
  if (!token || !repository) {
    throw new Error('GH_TOKEN and GITHUB_REPOSITORY are required.');
  }
  return {
    async request<T>(route: string, body?: Record<string, unknown>, accept = 'application/vnd.github+json'): Promise<T> {
      const [method, endpoint] = route.split(' ');
      if (!method || !endpoint) {
        throw new Error('Invalid GitHub API route.');
      }
      // eslint-disable-next-line no-restricted-globals -- Standalone Node workflow, not an Obsidian runtime request.
      const response = await fetch(`https://api.github.com${endpoint.replace('{repo}', repository)}`, {
        headers: {
          'Accept': accept,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        method,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) {
        throw new Error(`GitHub ${method} ${endpoint}: HTTP ${String(response.status)}. Check Actions permissions and rerun synchronization.`);
      }
      return (response.status === 204 ? undefined : await response.json()) as T;
    }
  };
}

export async function latestStable(api: GitHub): Promise<Release> {
  const release = await api.request<Release>('GET /repos/{repo}/releases/latest');
  releaseVersion(release);
  return release;
}

export async function releaseCommit(api: GitHub, release: Release): Promise<string> {
  const commit = await api.request<{ sha: string }>(`GET /repos/{repo}/commits/${encodeURIComponent(release.tag_name)}`);
  const comparison = await api.request<{ status: string }>(`GET /repos/{repo}/compare/${commit.sha}...main`);
  if (!['ahead', 'identical'].includes(comparison.status)) {
    throw new Error(`Stable release ${release.tag_name} is not an ancestor of main.`);
  }
  return commit.sha;
}

export function releaseVersion(release: Release): string {
  if (release.draft || release.prerelease || !release.tag_name.startsWith('external-note-folders-')) {
    throw new Error('Expected a published stable external-note-folders release.');
  }
  return stableVersion(release.tag_name.slice('external-note-folders-'.length));
}

export function summary(message: string): void {
  console.log(message);
  if (process.env['GITHUB_STEP_SUMMARY']) {
    appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${message}\n`);
  }
}
