import {
  assertPrimaryCheckout,
  getCurrentSandboxPaths,
  resolveProjectPath
} from './sandbox-paths.ts';
import {
  refreshSandboxArtifacts,
  reloadSandboxPlugin
} from './sandbox-refresh.ts';

async function main(): Promise<void> {
  assertPrimaryCheckout('Sandbox plugin refresh');
  const { vaultPath } = getCurrentSandboxPaths();
  const pluginId = await refreshSandboxArtifacts(resolveProjectPath('dist/build'), vaultPath);
  console.log(`Refreshed sandbox plugin files: ${pluginId}. Settings, journals, and fixtures preserved.`);
  await reloadSandboxPlugin(vaultPath, pluginId);
  console.log(`Reloaded sandbox plugin: ${pluginId}`);
}

// eslint-disable-next-line no-void -- script entry point
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
