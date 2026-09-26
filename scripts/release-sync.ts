/* eslint-disable camelcase -- GitHub REST and GraphQL field names. */
import type {
  GitHub,
  Release
} from './release-github.ts';

import {
  authenticatedActor,
  latestStable,
  releaseCommit,
  releaseVersion
} from './release-github.ts';
import { compareStable } from './release-metadata.ts';

interface PullRequest {
  auto_merge?: { merge_method: string } | null;
  base: { ref: string };
  body: null | string;
  head: { ref: string; repo: { full_name: string }; sha: string };
  html_url: string;
  mergeable_state?: string;
  node_id: string;
  number: number;
  state: string;
  user: { login: string };
}

const marker = '<!-- release-sync:v1 -->';

export async function synchronizeRelease(api: GitHub, repository: string, requestedTag?: string): Promise<string> {
  const latest = await latestStable(api);
  // Explicit publication callbacks retain their identity; they never select a different release.
  if (requestedTag && requestedTag !== latest.tag_name) {
    return `Skipped ${requestedTag}: latest stable is ${latest.tag_name}. Its own successful publication must trigger synchronization.`;
  }
  const release = requestedTag
    ? await api.request<Release>(`GET /repos/{repo}/releases/tags/${encodeURIComponent(requestedTag)}`)
    : latest;
  const version = releaseVersion(release);
  const sha = await verifyPublishedRelease(api, release);
  const dev = await api.request<{ object: { sha: string } }>('GET /repos/{repo}/git/ref/heads/dev');
  const comparison = await api.request<{ status: string }>(`GET /repos/{repo}/compare/${sha}...${dev.object.sha}`);
  if (['ahead', 'identical'].includes(comparison.status)) {
    const content = await api.request<{ content: string }>(`GET /repos/{repo}/contents/manifest.json?ref=${dev.object.sha}`);
    const manifest = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8')) as { version: string };
    if (compareStable(manifest.version, version) < 0) {
      throw new Error('dev contains the release commit but its metadata was downgraded. Repair metadata through a checked PR.');
    }
    return `dev already contains ${release.tag_name} (${sha}).`;
  }

  const actor = await authenticatedActor(api);
  const branch = `release-sync/${version}`;
  const owner = repository.split('/')[0] ?? '';
  const pulls = await api.request<PullRequest[]>(`GET /repos/{repo}/pulls?state=all&base=dev&head=${owner}:${branch}&per_page=100`);
  let pr = pulls.find((item) => item.state === 'open');
  if (pulls.length && !pr) {
    throw new Error(`Synchronization PR for ${version} was closed. Inspect and reopen it before retrying.`);
  }
  if (pr) {
    requireOwned(pr, repository, actor.login, branch);
  }
  const refs = await api.request<{ ref: string }[]>(`GET /repos/{repo}/git/matching-refs/heads/${branch}`);
  if (!refs.some((ref) => ref.ref === `refs/heads/${branch}`)) {
    await api.request('POST /repos/{repo}/git/refs', { ref: `refs/heads/${branch}`, sha });
  }
  const helper = await api.request<{ object: { sha: string } }>(`GET /repos/{repo}/git/ref/heads/${branch}`);
  if (!pr && helper.object.sha !== sha) {
    throw new Error(`Existing ${branch} has unrecognized changes. Inspect it before retrying.`);
  }
  pr ??= await api.request<PullRequest>('POST /repos/{repo}/pulls', {
    base: 'dev',
    body:
      `${marker}\n\nSynchronize verified stable ${release.tag_name} (${sha}) into dev.\n\nRelease assets and manifest are verified before this PR is maintained. Required CI must pass on the current revision. Merge with a merge commit to retain release ancestry.\n\nRelease impact: none; carries existing Release Please metadata.\n\nIf checks or merging fail, resolve the problem on this branch and rerun the release-sync workflow.`,
    head: branch,
    maintainer_can_modify: true,
    title: `ci: synchronize stable ${version} into dev`
  });
  // Update through a merge, never a reset or force push. A conflict leaves the PR available for recovery.
  await api.request('POST /repos/{repo}/merges', {
    base: branch,
    commit_message: `Merge dev into ${branch}`,
    head: dev.object.sha
  });
  const refreshed = await api.request<PullRequest>(`GET /repos/{repo}/pulls/${String(pr.number)}`);
  requireOwned(refreshed, repository, actor.login, branch);
  const merged = await api.request<{ status: string }>(`GET /repos/{repo}/compare/${sha}...${refreshed.head.sha}`);
  if (!['ahead', 'identical'].includes(merged.status)) {
    throw new Error('Synchronization branch no longer contains the verified release commit.');
  }
  const currentDev = await api.request<{ object: { sha: string } }>('GET /repos/{repo}/git/ref/heads/dev');
  if (currentDev.object.sha !== dev.object.sha || (await latestStable(api)).tag_name !== release.tag_name) {
    throw new Error('dev or latest stable changed during synchronization. Rerun release-sync.');
  }
  await requireProtection(api);
  await requestMerge(api, refreshed);
  await closeSuperseded(api, repository, actor.login, pr.number, version);
  return `Auto-merge requested for ${pr.html_url}. Required checks must pass; conflicts or failing checks need intervention.`;
}

export async function verifyPublishedRelease(api: GitHub, release: Release): Promise<string> {
  const version = releaseVersion(release);
  for (const name of ['main.js', 'styles.css', 'manifest.json']) {
    const assets = release.assets.filter((asset) => asset.name === name && asset.size > 0 && asset.state === 'uploaded');
    if (assets.length !== 1) {
      throw new Error(`${release.tag_name} needs exactly one uploaded, nonempty ${name}. Retry asset publication first.`);
    }
  }
  const asset = release.assets.find((item) => item.name === 'manifest.json');
  if (!asset) {
    throw new Error('Published manifest asset is missing.');
  }
  const manifest = await api.request<{ id: string; minAppVersion: string; version: string }>(
    `GET /repos/{repo}/releases/assets/${String(asset.id)}`,
    undefined,
    'application/octet-stream'
  );
  const sha = await releaseCommit(api, release);
  const content = await api.request<{ content: string }>(`GET /repos/{repo}/contents/manifest.json?ref=${sha}`);
  const source = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8')) as typeof manifest;
  if (
    manifest.id !== 'external-note-folders' || manifest.version !== version || source.version !== version
    || !manifest.minAppVersion || manifest.minAppVersion !== source.minAppVersion
  ) {
    throw new Error(`Published manifest does not match ${release.tag_name}. Retry asset publication first.`);
  }
  return sha;
}

async function closeSuperseded(api: GitHub, repository: string, actor: string, number: number, version: string): Promise<void> {
  const open = await api.request<PullRequest[]>('GET /repos/{repo}/pulls?state=open&base=dev&per_page=100');
  for (const older of open) {
    const oldVersion = older.head.ref.replace('release-sync/', '');
    if (
      older.number !== number && /^release-sync\/\d+\.\d+\.\d+$/.test(older.head.ref) && older.body?.startsWith(marker)
      && older.user.login === actor && older.head.repo.full_name === repository && compareStable(oldVersion, version) < 0
    ) {
      await api.request(`PATCH /repos/{repo}/pulls/${String(older.number)}`, { state: 'closed' });
    }
  }
}

async function requestMerge(api: GitHub, pr: PullRequest): Promise<void> {
  if (pr.auto_merge?.merge_method === 'merge') {
    return;
  }
  if (pr.mergeable_state === 'clean') {
    const result = await api.request<{ merged: boolean }>(`PUT /repos/{repo}/pulls/${String(pr.number)}/merge`, {
      merge_method: 'merge',
      sha: pr.head.sha
    });
    if (!result.merged) {
      throw new Error(`GitHub did not merge ${pr.html_url}. Inspect required checks and retry.`);
    }
    return;
  }
  // GitHub enforces required checks on the latest PR revision. This never uses a bypass merge.
  const enabled = await api.request<{ errors?: unknown[] }>('POST /graphql', {
    query: 'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:MERGE}){pullRequest{id}}}',
    variables: { id: pr.node_id }
  });
  if (enabled.errors?.length) {
    throw new Error(`Could not enable auto-merge for ${pr.html_url}. Check PR requirements and rerun release-sync.`);
  }
}

function requireOwned(pr: PullRequest, repository: string, actor: string, branch: string): void {
  if (
    pr.base.ref !== 'dev' || pr.head.ref !== branch || pr.head.repo.full_name !== repository
    || pr.user.login !== actor || !pr.body?.startsWith(marker) || pr.state !== 'open'
  ) {
    throw new Error('Refusing to modify a PR that is not owned by release synchronization.');
  }
}

async function requireProtection(api: GitHub): Promise<void> {
  const repo = await api.request<{ allow_auto_merge: boolean; allow_merge_commit: boolean }>('GET /repos/{repo}');
  const protection = await api.request<{
    allow_deletions?: { enabled: boolean };
    allow_force_pushes?: { enabled: boolean };
    enforce_admins?: { enabled: boolean };
    required_conversation_resolution?: { enabled: boolean };
    required_linear_history?: { enabled: boolean };
    required_pull_request_reviews?: { required_approving_review_count: number };
    required_status_checks?: { contexts: string[]; strict: boolean };
  }>('GET /repos/{repo}/branches/dev/protection');
  if (
    !repo.allow_auto_merge || !repo.allow_merge_commit || !protection.required_status_checks?.strict
    || !['validate', 'conventional-commits'].every((check) => protection.required_status_checks?.contexts.includes(check) === true)
    || protection.required_pull_request_reviews?.required_approving_review_count !== 0
    || !protection.enforce_admins?.enabled || !protection.required_conversation_resolution?.enabled
    || protection.required_linear_history?.enabled || protection.allow_force_pushes?.enabled || protection.allow_deletions?.enabled
  ) {
    throw new Error('dev protection or repository auto-merge settings do not match the release procedure. Configure them before retrying.');
  }
}
/* eslint-enable camelcase -- End of GitHub API payloads. */
