import { execFileSync } from 'node:child_process';

import type { GitHub } from './release-github.ts';

import {
  latestStable,
  releaseCommit,
  releaseVersion
} from './release-github.ts';
import {
  checkMetadata,
  compareStable,
  requireBetaVersion
} from './release-metadata.ts';

export async function checkBetaSource(api: GitHub, root: string, beta: string): Promise<string> {
  const release = await latestStable(api);
  const stable = releaseVersion(release);
  const sha = await releaseCommit(api, release);
  const metadata = checkMetadata(root);
  requireBetaVersion(beta, stable);
  if (compareStable(metadata.version, stable) < 0) {
    throw new Error(`Source version ${metadata.version} is older than ${stable}. Merge the release synchronization PR first.`);
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'pipe' });
  } catch {
    throw new Error(`Source must contain stable ${release.tag_name} (${sha}). Fetch tags and merge the synchronization PR first.`);
  }
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return `Beta source: ${source}; baseline: ${metadata.version}; latest stable: ${stable}; artifact: ${beta}.`;
}
