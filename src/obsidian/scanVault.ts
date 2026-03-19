import type { App } from 'obsidian';

import { getExfFrontmatterValue } from '../core/frontmatter.ts';
import type { VaultScanResult } from '../core/verify.ts';

export function scanVault(app: App): VaultScanResult {
  const bindings = new Map<string, string>();
  const duplicatePaths = new Map<string, string[]>();
  const invalidFrontmatter: VaultScanResult['invalidFrontmatter'] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    const exfValue = getExfFrontmatterValue(frontmatter);
    if (exfValue.kind === 'missing') {
      continue;
    }

    if (exfValue.kind === 'invalid') {
      invalidFrontmatter.push({
        location: file.path,
        message: `${exfValue.reason}.`
      });
      continue;
    }

    registerBinding(bindings, duplicatePaths, exfValue.uuid, file.path);
  }

  return {
    bindings,
    duplicatePaths,
    invalidFrontmatter: invalidFrontmatter.sort((left, right) => left.location.localeCompare(right.location))
  };
}

function registerBinding(
  bindings: Map<string, string>,
  duplicatePaths: Map<string, string[]>,
  uuid: string,
  path: string
): void {
  const existingPath = bindings.get(uuid);
  if (!existingPath) {
    bindings.set(uuid, path);
    return;
  }

  const duplicateSet = new Set<string>(duplicatePaths.get(uuid) ?? [existingPath]);
  duplicateSet.add(path);
  duplicatePaths.set(uuid, [...duplicateSet].sort());
}
