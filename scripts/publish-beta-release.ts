import { execFileSync } from 'node:child_process';

import {
  githubClient,
  summary
} from './release-github.ts';

const api = githubClient();
const version = process.env['BETA_VERSION'] ?? '';
const sha = process.env['SOURCE_SHA'] ?? '';
const tag = `external-note-folders-${version}`;
// Creating the ref is atomic: an existing tag fails, even if another publisher just created it.
await api.request('POST /repos/{repo}/git/refs', { ref: `refs/tags/${tag}`, sha });
try {
  execFileSync('gh', [
    'release',
    'create',
    tag,
    'release-assets/main.js',
    'release-assets/styles.css',
    'release-assets/manifest.json',
    '--repo',
    process.env['GITHUB_REPOSITORY'] ?? '',
    '--verify-tag',
    '--prerelease',
    '--latest=false',
    '--title',
    `external-note-folders: v${version}`,
    '--notes',
    `BRAT prerelease built from ${sha}. Source baseline: ${process.env['SOURCE_BASELINE'] ?? ''}. Artifact version: ${version}.`
  ], { stdio: 'inherit' });
  summary(`Published ${tag} from ${sha}.`);
} catch {
  throw new Error(
    `Publication failed after reserving ${tag}. Inspect the release and assets; do not move or reuse the tag. Publish a new beta version after resolving the failure.`
  );
}
