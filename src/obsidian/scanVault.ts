import type { App } from 'obsidian';

import type { VaultScanResult } from '../core/verify.ts';

import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import { registerUuidBinding } from '../core/scanResult.ts';

export function scanVault(app: App): VaultScanResult {
  const bindings = new Map<string, string>();
  const duplicatePaths = new Map<string, string[]>();
  const invalidFrontmatter: VaultScanResult['invalidFrontmatter'] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    const exnfValue = getExnfFrontmatterValue(frontmatter);
    if (exnfValue.kind === 'missing') {
      continue;
    }

    if (exnfValue.kind === 'invalid') {
      invalidFrontmatter.push({
        location: file.path,
        message: `${exnfValue.reason}.`
      });
      continue;
    }

    registerUuidBinding(bindings, duplicatePaths, exnfValue.uuid, file.path);
  }

  return {
    bindings,
    duplicatePaths,
    invalidFrontmatter: invalidFrontmatter.sort((left, right) => left.location.localeCompare(right.location))
  };
}
