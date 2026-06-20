import {
  assertSupportedObsidianVersion,
  MINIMUM_OBSIDIAN_VERSION,
  runObsidianCli
} from './obsidian-cli.ts';
import {
  assertPrimaryCheckout,
  resolveProjectPath
} from './sandbox-paths.ts';

const CLI_TIMEOUT_MILLISECONDS = 15_000;

try {
  assertPrimaryCheckout('Obsidian CLI integration');
  const version = assertSupportedObsidianVersion(
    runObsidianCli(['version'], resolveProjectPath('.'), CLI_TIMEOUT_MILLISECONDS)
  );
  console.log(`Obsidian CLI preflight passed: ${version.text} (minimum ${MINIMUM_OBSIDIAN_VERSION}).`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
