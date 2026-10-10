import { randomUUID } from 'node:crypto';
import {
  readFile,
  unlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  formatObsidianCliResult,
  runObsidianCli
} from './obsidian-cli.ts';

const RELOAD_SUCCESS = 'EXNF_SANDBOX_REFRESHED';
const ARTIFACTS = ['main.js', 'styles.css', 'manifest.json'] as const;

/** Guard the runtime in the same evaluation that reloads it; do not rely on focus. */
export function buildSandboxReloadScript(vaultPath: string, pluginId: string): string {
  return `(async () => {
    const path = require('node:path');
    const key = value => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    if (key(app.vault.adapter.getBasePath()) !== key(${JSON.stringify(vaultPath)})) {
      throw new Error('Refusing to reload outside the sandbox vault.');
    }
    const id = ${JSON.stringify(pluginId)};
    const previous = app.plugins.getPlugin(id);
    if (!previous) throw new Error('Sandbox plugin is disabled; enable it before refreshing.');
    if (previous.isMutationInProgress) throw new Error('Sandbox mutation is running; retry refresh when it finishes.');
    await app.plugins.disablePlugin(id);
    await app.plugins.enablePlugin(id);
    const current = app.plugins.getPlugin(id);
    if (!current || current === previous) throw new Error('Sandbox plugin did not reload.');
    return '${RELOAD_SUCCESS}';
  })()`;
}

/** Refresh an existing sandbox installation without resetting its state. */
export async function refreshSandboxArtifacts(buildDirectory: string, vaultPath: string): Promise<string> {
  // Read the whole build before replacing any installed artifact. Never fall back
  // To a root-level bundle that may be older than the successful build.
  const artifacts = await Promise.all(ARTIFACTS.map(async (name) => ({
    content: await readFile(path.join(buildDirectory, name)),
    name
  })));
  const manifest: unknown = JSON.parse(artifacts[2].content.toString('utf8'));
  if (!hasPluginId(manifest) || !/^[a-z0-9-]+$/u.test(manifest.id)) {
    throw new Error('Built manifest has an invalid plugin id.');
  }
  const pluginPath = path.join(vaultPath, '.obsidian', 'plugins', manifest.id);
  const installed: unknown = JSON.parse(await readFile(path.join(pluginPath, 'manifest.json'), 'utf8'));
  if (!hasPluginId(installed) || installed.id !== manifest.id) {
    throw new Error('Existing sandbox installation does not match the built plugin.');
  }
  for (const artifact of artifacts) {
    await writeFile(path.join(pluginPath, artifact.name), artifact.content);
  }
  return manifest.id;
}

export async function reloadSandboxPlugin(vaultPath: string, pluginId: string): Promise<void> {
  // Use a short CLI loader to avoid Windows multiline argument transport limits.
  const scriptPath = path.join(tmpdir(), `exnf-refresh-${randomUUID()}.js`);
  await writeFile(scriptPath, buildSandboxReloadScript(vaultPath, pluginId), 'utf8');
  try {
    const result = runObsidianCli(
      ['eval', `code=eval(require('fs').readFileSync(${JSON.stringify(scriptPath)},'utf8'))`],
      vaultPath,
      30_000
    );
    if (result.status !== 0 || result.errorMessage || !result.stdout.includes(RELOAD_SUCCESS)) {
      throw new Error(`Plugin files refreshed, but runtime reload was not confirmed.\n${formatObsidianCliResult(result)}`);
    }
  } finally {
    await unlink(scriptPath);
  }
}

function hasPluginId(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';
}
