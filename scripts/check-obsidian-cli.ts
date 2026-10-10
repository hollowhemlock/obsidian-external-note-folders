import { randomUUID } from 'node:crypto';
import {
  readFile,
  unlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertSupportedObsidianVersion,
  MINIMUM_OBSIDIAN_VERSION,
  runObsidianCli
} from './obsidian-cli.ts';
import {
  assertPrimaryCheckout,
  getCurrentSandboxPaths,
  resolveProjectPath
} from './sandbox-paths.ts';
import {
  buildSandboxReadinessScript,
  waitForSandboxReadiness
} from './sandbox-readiness.ts';

async function main(): Promise<void> {
  assertPrimaryCheckout('Obsidian CLI integration');
  const manifest: unknown = JSON.parse(await readFile(resolveProjectPath('manifest.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('id' in manifest) || typeof manifest.id !== 'string') {
    throw new Error('Plugin manifest has no id.');
  }
  const sandboxVaultPath = getCurrentSandboxPaths().vaultPath;
  const scriptPath = path.join(tmpdir(), `exnf-readiness-${randomUUID()}.js`);
  await writeFile(scriptPath, buildSandboxReadinessScript(sandboxVaultPath, manifest.id), 'utf8');
  try {
    await waitForSandboxReadiness((remaining) =>
      runObsidianCli(
        ['eval', `code=eval(require('fs').readFileSync(${JSON.stringify(scriptPath)},'utf8'))`],
        sandboxVaultPath,
        Math.min(5_000, remaining)
      )
    );
  } finally {
    await unlink(scriptPath);
  }
  const version = assertSupportedObsidianVersion(runObsidianCli(['version'], sandboxVaultPath, 5_000));
  console.log(`Obsidian CLI preflight passed: ${version.text} (minimum ${MINIMUM_OBSIDIAN_VERSION}).`);
  console.log(`Sandbox vault, plugin, and commands are ready: ${sandboxVaultPath}`);
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
