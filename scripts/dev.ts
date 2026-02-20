/**
 * Development build script. Builds the plugin and copies output to the
 * dev vault and any additional vaults specified via environment variables:
 *   - OBSIDIAN_CONFIG_FOLDER  — single additional vault path
 *   - OBSIDIAN_CONFIG_FOLDERS — comma-separated additional vault paths
 */

import { readFileSync } from 'node:fs';
import { CliTaskResult } from 'obsidian-dev-utils/ScriptUtils/CliUtils';
import { copyToObsidianPluginsFolderPlugin } from 'obsidian-dev-utils/ScriptUtils/esbuild/copyToObsidianPluginsFolderPlugin';
import {
  BuildMode,
  buildObsidianPlugin
} from 'obsidian-dev-utils/ScriptUtils/esbuild/ObsidianPluginBuilder';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

/** Relative path to the on-repo sandbox vault's .obsidian config directory. */
// eslint-disable-next-line obsidianmd/hardcoded-config-path -- filesystem path, not runtime Vault access
const DEV_VAULT_PATH = 'test/fixtures/sandbox/vault/.obsidian';
/** Relative path to the dev build output directory. */
const DEV_DIST_PATH = 'dist/dev';

export async function invoke(): Promise<CliTaskResult> {
  const devVaultConfigDir = resolvePathFromRoot(DEV_VAULT_PATH)
    ?? ((): never => {
      throw new Error(
        `Could not find '${DEV_VAULT_PATH}' in project root. Run: npm run fixtures:new-sandbox`
      );
    })();

  // Collect additional OBSIDIAN_CONFIG_FOLDERS (comma-separated)
  const additionalObsidianConfigFolders: string[] = [];

  if (process.env['OBSIDIAN_CONFIG_FOLDER']) {
    additionalObsidianConfigFolders.push(
      process.env['OBSIDIAN_CONFIG_FOLDER']
    );
  }

  if (process.env['OBSIDIAN_CONFIG_FOLDERS']) {
    additionalObsidianConfigFolders.push(
      ...process.env['OBSIDIAN_CONFIG_FOLDERS']
        .split(',')
        .map((p) => (p.trim()))
    );
  }

  const manifestPath = resolvePathFromRoot('manifest.json')
    ?? ((): never => {
      throw new Error('Failed to resolve manifest.json path');
    })();
  const pluginId = (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { id: string }).id;
  const devDistribution = resolvePathFromRoot(DEV_DIST_PATH);
  if (!devDistribution) {
    throw new Error(`Failed to resolve ${DEV_DIST_PATH} path`);
  }

  // Create copy plugins for additional vault folders
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
