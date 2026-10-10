import type { App } from 'obsidian';

import { parseYaml } from 'obsidian';

import type { MarkerRepairNote } from '../core/markerRepair.ts';

import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import { buildTemplateExclusionMatcher } from '../core/templateExclusions.ts';

export async function readMarkerRepairNote(app: App, notePath: string): Promise<MarkerRepairNote> {
  const content = await app.vault.adapter.read(notePath);
  return { identity: getExnfFrontmatterValue(readRepairFrontmatter(content)), notePath };
}
/** Read through the adapter: an absent cache entry is not evidence of absent identity. */
export async function readMarkerRepairNotes(app: App, patterns: readonly string[], signal?: AbortSignal): Promise<MarkerRepairNote[]> {
  const matcher = buildTemplateExclusionMatcher(patterns);
  const notes: MarkerRepairNote[] = [];
  const directories = [''];
  const seen = new Set<string>();
  while (directories.length) {
    signal?.throwIfAborted();
    const directory = directories.pop();
    if (directory === undefined) {
      break;
    }
    if (seen.has(directory)) {
      throw new Error(`Vault enumeration repeated a directory: ${directory}`);
    }
    seen.add(directory);
    const listing = await app.vault.adapter.list(directory);
    for (const child of [...listing.folders, ...listing.files]) {
      if (
        child.split('/').some((part) => part === '..') || child.slice(directory ? directory.length + 1 : 0).includes('/')
        || (directory && !child.startsWith(`${directory}/`))
      ) {
        throw new Error(`Vault enumeration returned an unsafe path: ${child}`);
      }
    }
    directories.push(...listing.folders.filter((folder) => folder !== app.vault.configDir && !matcher.ignoresRelativeDirectoryPath(folder)));
    for (const notePath of listing.files.sort()) {
      signal?.throwIfAborted();
      if (!notePath.endsWith('.md') || matcher.ignoresRelativeFilePath(notePath)) {
        continue;
      }
      try {
        notes.push(await readMarkerRepairNote(app, notePath));
      } catch (error: unknown) {
        throw new Error(`Cannot verify note ownership at ${notePath}: ${String(error)}`, { cause: error });
      }
    }
  }
  return notes.sort((a, b) => a.notePath.localeCompare(b.notePath));
}
export function readRepairFrontmatter(content: string): Record<string, unknown> | undefined {
  if (!/^\uFEFF?---\r?\n/u.test(content)) {
    return undefined;
  }
  const match = /^\uFEFF?---\r?\n(?<yaml>(?:[^\n]*\n)*?)---[ \t]*(?:\r?\n|$)/u.exec(content);
  if (!match) {
    throw new Error('Frontmatter has no closing delimiter.');
  }
  const value: unknown = parseYaml(match.groups?.['yaml'] ?? '');
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Frontmatter must be a mapping.');
  }
  return value as Record<string, unknown>;
}
