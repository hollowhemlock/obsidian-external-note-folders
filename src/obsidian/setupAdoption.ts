import type { App } from 'obsidian';

// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computations at the adapter boundary.
import path from 'node:path';

import type { SetupPlan } from '../core/setupPlan.ts';

import { getExnfFrontmatterValue } from '../core/frontmatter.ts';
import { buildGroupAdoptionPlan } from '../core/groupAdoption.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from '../core/pathPolicy.ts';
import { generateUnusedCanonicalUuid } from '../core/uuid.ts';
import { inspectAdoption } from '../storage/adoptionInspection.ts';
import { inspectGroupMarker } from '../storage/groupAdoptionJournal.ts';
import { readRepairFrontmatter } from './markerRepairVault.ts';

export async function checkSetupAdoption(app: App, input: {
  externalRoot: string;
  ignorePatterns: readonly string[];
  knownMarkerPaths: readonly string[];
  mutationSequence: number;
  notePath: string;
  resume?: boolean;
  sourceContent?: string;
  templatePatterns: readonly string[];
  uuid?: string;
  vaultRoot: string;
}): Promise<SetupPlan> {
  const target = deriveExternalFolderPath(input.notePath, input.externalRoot);
  const { inspectionPolicy, snapshot } = await inspectAdoption({ ...input, targets: [target] });
  const content = await app.vault.adapter.read(input.notePath);
  const source = input.sourceContent ?? content;
  const identity = getExnfFrontmatterValue(readRepairFrontmatter(content));
  if (getExnfFrontmatterValue(readRepairFrontmatter(source)).kind !== 'missing') {
    throw new Error('The original adoption note must have no identifier.');
  }
  const uuid = input.uuid
    ?? generateUnusedCanonicalUuid(new Set([...snapshot.notes.map((note) => note.uuid), ...snapshot.markers.map((marker) => marker.uuid)]));
  if (identity.kind === 'invalid' || (identity.kind === 'valid' && (!input.resume || identity.uuid !== uuid))) {
    throw new Error('Note identity changed before adoption.');
  }
  if (content !== source && !(input.resume && identity.kind === 'valid' && matchesIdentityWrite(source, content))) {
    throw new Error('Note changed since confirmation.');
  }
  if (input.resume) {
    await inspectGroupMarker(snapshot.externalRoot, target, uuid);
    snapshot.markers = snapshot.markers.filter((marker) =>
      !(marker.markerPath === path.join(target, `${uuid}.exnf`) && marker.status === 'valid' && marker.uuid === uuid)
    );
    const own = snapshot.notes.find((note) => note.relativePath === input.notePath);
    if (own?.uuid === uuid) {
      own.uuid = '';
      own.hasExnf = false;
      own.status = 'missing-property';
    }
  }
  const plan = buildGroupAdoptionPlan({
    folderPath: target,
    ignorePatterns: [...input.ignorePatterns],
    inspectionPolicy,
    move: false,
    mutationSequence: input.mutationSequence,
    note: { aliases: undefined, path: input.notePath },
    snapshot,
    uuid
  });
  if (
    plan.descendants.some((note) =>
      snapshot.folders.some((folder) => normalizePathForIdentity(folder) === normalizePathForIdentity(deriveExternalFolderPath(note, snapshot.externalRoot)))
    )
  ) {
    throw new Error('A deeper exact note/folder candidate must be set up first.');
  }
  return {
    action: 'confirm-unmarked-adoption',
    adoptionSourceContent: source,
    errors: [],
    externalRootPath: snapshot.externalRoot,
    ignoredDirectoryCount: inspectionPolicy.omissions.length,
    inspectionPolicy,
    legacyMarkerPaths: [],
    mutationSequence: input.mutationSequence,
    notePath: input.notePath,
    targetPath: target,
    uuid
  };
}

function matchesIdentityWrite(before: string, after: string): boolean {
  const original = { ...readRepairFrontmatter(before) };
  const current = { ...readRepairFrontmatter(after) };
  delete current['exnf'];
  function body(text: string): string {
    return text.replace(/^\uFEFF?---\r?\n(?:[^\n]*\n)*?---[ \t]*(?:\r?\n|$)/u, '').replace(/^\r?\n/u, '');
  }
  return JSON.stringify(original) === JSON.stringify(current) && body(before) === body(after);
}
