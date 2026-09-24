import {
  githubClient,
  summary
} from './release-github.ts';
import { synchronizeRelease } from './release-sync.ts';

try {
  summary(await synchronizeRelease(githubClient(), process.env['GITHUB_REPOSITORY'] ?? '', process.env['RELEASE_TAG']));
} catch (error) {
  summary(
    `Release synchronization blocked: ${
      error instanceof Error ? error.message : String(error)
    }\n\nInspect the synchronization PR and failed Actions step. Resolve conflicts or permissions, then rerun release-sync from main. No branch is force-pushed and no protection is bypassed.`
  );
  process.exitCode = 1;
}
