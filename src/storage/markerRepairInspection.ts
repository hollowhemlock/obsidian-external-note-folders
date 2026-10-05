import {
  lstat,
  readdir,
  readFile
} from 'node:fs/promises';
import path from 'node:path';

import type { MarkerRepairContext } from '../core/markerRepair.ts';
import type { SetupTargetInspection } from '../core/setupPlan.ts';
import type { GitIgnoreRepository } from './gitStatusIgnore.ts';

import { buildExternalRootIgnoreMatcher } from '../core/externalRootIgnore.ts';
import {
  classifyExnfMarkerFileName,
  parseLegacyExnfMarkerFile
} from '../core/marker.ts';
import {
  assertPathIsWithinRoot,
  normalizePathForIdentity as identity
} from '../core/pathPolicy.ts';
import { resolveExternalRootPath } from './boundExternalFolder.ts';
import { GitStatusIgnore } from './gitStatusIgnore.ts';
import { inspectSetupTarget } from './setupTarget.ts';

export async function inspectMarkerRepair(
  context: MarkerRepairContext,
  signal?: AbortSignal
): Promise<{ inspection: SetupTargetInspection; knownMatches: string[] }> {
  const root = await resolveExternalRootPath(context.externalRootPath);
  if (identity(root) !== identity(context.externalRootPath)) {
    throw new Error('External root changed. Preview again.');
  }
  assertPathIsWithinRoot(root, context.targetPath);
  const matcher = buildExternalRootIgnoreMatcher(root, context.ignorePatterns);
  if (matcher.errors.length) {
    throw new Error('Invalid external exclusion settings.');
  }
  const git = new GitStatusIgnore(signal);
  const repositories = new Map<string, GitIgnoreRepository | null>();
  try {
    repositories.set(root, await git.initialize(root));
    const inspection = await inspectSetupTarget({
      externalRootPath: root,
      ignorePatterns: [],
      notePath: context.notePath,
      ...(signal ? { signal } : {}),
      directoryPolicy: async (directory) => {
        if (directory === root) {
          return null;
        }
        if (matcher.ignoresAbsoluteDirectoryPath(directory)) {
          return 'Excluded by external root ignore patterns.';
        }
        if (path.basename(directory) === '.git') {
          return 'Git metadata excluded from filtered scans.';
        }
        const parent = repositories.get(path.dirname(directory)) ?? null;
        const ignored = await parent?.ignores(directory);
        if (ignored) {
          return ignored;
        }
        // Never ask Git to enter a linked directory.
        const stat = await lstat(directory);
        if (!stat.isSymbolicLink()) {
          repositories.set(directory, await git.context(directory, parent));
        }
        return null;
      }
    });
    const knownMatches: string[] = [];
    for (const folder of [...new Set(context.knownFolders)].sort()) {
      signal?.throwIfAborted();
      if (identity(folder) !== identity(context.targetPath) && await knownMarkerMatches(root, folder, context.uuid)) {
        knownMatches.push(folder);
      }
    }
    await git.finish();
    return { inspection, knownMatches };
  } finally {
    git.dispose();
  }
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

async function knownMarkerMatches(root: string, folder: string, uuid: string): Promise<boolean> {
  assertPathIsWithinRoot(root, folder);
  let current = root;
  try {
    for (const segment of path.relative(root, folder).split(path.sep)) {
      current = path.join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Known binding path is unsafe: ${current}`);
      }
    }
    let matches = false;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      let marker;
      try {
        marker = classifyExnfMarkerFileName(entry.name);
      } catch {
        continue;
      }
      if (marker.kind === 'not-marker') {
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Known marker cannot be checked: ${path.join(folder, entry.name)}`);
      }
      if (marker.kind === 'uuid-named') {
        matches ||= marker.uuid === uuid;
      } else {
        const content = await readFile(path.join(folder, entry.name), 'utf8');
        try {
          matches ||= parseLegacyExnfMarkerFile(entry.name, content).uuid === uuid;
        } catch { /* Parsed malformed identity is not a matching UUID. */ }
      }
    }
    return matches;
  } catch (error: unknown) {
    if (isMissing(error)) {
      try {
        await lstat(folder);
      } catch (missing: unknown) {
        if (isMissing(missing)) {
          return false;
        }
      }
    }
    throw error;
  }
}
