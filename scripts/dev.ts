/**
 * Development build script. Builds the plugin and copies output to the
 * dev vault and any additional vaults specified via environment variables:
 *   - OBSIDIAN_CONFIG_FOLDER  — single additional vault path
 *   - OBSIDIAN_CONFIG_FOLDERS — comma-separated additional vault paths
 *
 * When this repository has multiple Git worktrees, existing sibling worktree
 * sandbox vaults are also copy targets so a local sandbox and a linked worktree
 * sandbox can both run the current build.
 */

import {
  existsSync,
  readFileSync
} from 'node:fs';
import { CliTaskResult } from 'obsidian-dev-utils/ScriptUtils/CliUtils';
import { copyToObsidianPluginsFolderPlugin } from 'obsidian-dev-utils/ScriptUtils/esbuild/copyToObsidianPluginsFolderPlugin';
import {
  BuildMode,
  buildObsidianPlugin
} from 'obsidian-dev-utils/ScriptUtils/esbuild/ObsidianPluginBuilder';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

import {
  getAdditionalObsidianConfigFoldersFromEnv,
  getCurrentSandboxPaths,
  getExistingLinkedWorktreeSandboxPaths,
  isSamePath,
  SANDBOX_VAULT_RELATIVE_PATH,
  uniqueResolvedPaths
} from './sandbox-paths.ts';

/** Relative path to the dev build output directory. */
const DEV_DIST_PATH = 'dist/dev';

export async function invoke(): Promise<CliTaskResult> {
  const currentSandboxPaths = getCurrentSandboxPaths();
  if (!existsSync(currentSandboxPaths.obsidianConfigPath)) {
    throw new Error(
      `Could not find '${SANDBOX_VAULT_RELATIVE_PATH}/.obsidian' in project root. Run: npm run fixtures:new-sandbox`
    );
  }
  const devVaultConfigDir = currentSandboxPaths.obsidianConfigPath;
  const additionalObsidianConfigFolders = uniqueResolvedPaths([
    ...getAdditionalObsidianConfigFoldersFromEnv(),
    ...getExistingLinkedWorktreeSandboxPaths().map((sandboxPaths) => sandboxPaths.obsidianConfigPath)
  ]).filter((obsidianConfigFolder) => !isSamePath(obsidianConfigFolder, devVaultConfigDir));

  const manifestPath = resolvePathFromRoot('manifest.json')
    ?? ((): never => {
      throw new Error('Failed to resolve manifest.json path');
    })();
  const pluginId = (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { id: string }).id;
  const devDistribution = resolvePathFromRoot(DEV_DIST_PATH);
  if (!devDistribution) {
    throw new Error(`Failed to resolve ${DEV_DIST_PATH} path`);
  }

  const customEsbuildPlugins = additionalObsidianConfigFolders.map(
    (additionalObsidianConfigFolder: string) =>
      copyToObsidianPluginsFolderPlugin(
        false,
        devDistribution,
        additionalObsidianConfigFolder,
        pluginId
      )
  );

  // Build the plugin in development mode
  const result = await buildObsidianPlugin({
    customEsbuildPlugins,
    mode: BuildMode.Development,
    obsidianConfigFolder: devVaultConfigDir
  });

  return result;
}
