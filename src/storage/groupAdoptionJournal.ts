/* eslint-disable require-atomic-updates -- The single-flight executor exclusively owns its mutable journal. */
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import type { GroupAdoptionPlan } from '../core/groupAdoption.ts';

import { assertPathIsWithinRoot } from '../core/pathPolicy.ts';
import { isCanonicalUuid } from '../core/uuid.ts';

const JSON_INDENT = 2;

export interface GroupAdoptionEffects {
  marker: () => Promise<void>;
  move: (interrupted: boolean) => Promise<void>;
  note: () => Promise<void>;
  verify: () => Promise<void>;
}

export interface GroupAdoptionJournal {
  attempted: boolean;
  error: string;
  kind: 'group-adoption';
  plan: GroupAdoptionPlan;
  preparedContent: null | string;
  schemaVersion: 1;
  sourceContent: null | string;
  stage: GroupAdoptionStage;
}
export type GroupAdoptionStage = 'complete' | 'marker' | 'move' | 'note' | 'verify';
export async function assertSafeNotePath(root: string, relative: string): Promise<void> {
  if (
    !relative.endsWith('.md') || relative.includes('\\') || relative.split('/').some((part) => !part || part === '.' || part === '..')
    || path.isAbsolute(relative)
  ) {
    throw new Error('Unsafe note path.');
  }
  let current = root;
  for (const part of ['', ...relative.split('/')]) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`Note path crosses a link: ${current}`);
      }
      if (current !== path.join(root, relative) && !info.isDirectory()) {
        throw new Error(`Note parent is not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
export async function createGroupJournal(root: string, plan: GroupAdoptionPlan, sourceContent: null | string): Promise<string> {
  await mkdir(root, { recursive: true });
  const file = path.join(root, `${randomUUID()}.json`);
  const journal: GroupAdoptionJournal = {
    attempted: false,
    error: '',
    kind: 'group-adoption',
    plan,
    preparedContent: null,
    schemaVersion: 1,
    sourceContent,
    stage: 'marker'
  };
  await writeFile(file, JSON.stringify(journal, null, JSON_INDENT), { flag: 'wx' });
  return file;
}
export async function inspectGroupMarker(root: string, folder: string, uuid: string): Promise<boolean> {
  assertPathIsWithinRoot(root, folder);
  const segments = path.relative(root, folder).split(path.sep);
  let current = root;
  for (const segment of ['', ...segments]) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Unsafe external directory: ${current}`);
    }
    const markers = (await readdir(current)).filter((name) => name.toLowerCase().endsWith('.exnf'));
    if (current !== folder && markers.length) {
      throw new Error(`Ancestor contains a marker: ${current}`);
    }
    if (current === folder) {
      if (!markers.length) {
        return false;
      }
      if (markers.length !== 1 || markers[0] !== `${uuid}.exnf`) {
        throw new Error(`External marker changed: ${folder}`);
      }
      const marker = await lstat(path.join(folder, markers[0]));
      if (!marker.isFile() || marker.isSymbolicLink()) {
        throw new Error('Marker is not a regular file.');
      }
      return true;
    }
  }
  return false;
}
export async function pendingGroupJournals(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const pending: string[] = [];
  for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
    const file = path.join(root, entry);
    if ((await readGroupJournal(file)).stage !== 'complete') {
      pending.push(file);
    }
  }
  return pending;
}
export async function readGroupJournal(file: string): Promise<GroupAdoptionJournal> {
  const journal: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isGroupJournal(journal)) {
    throw new Error(`Invalid group adoption journal: ${file}`);
  }
  return journal;
}
export async function runGroupJournal(journal: GroupAdoptionJournal, effects: GroupAdoptionEffects, save: () => Promise<void>): Promise<void> {
  const next: Record<Exclude<GroupAdoptionStage, 'complete'>, GroupAdoptionStage> = { marker: 'note', move: 'verify', note: 'move', verify: 'complete' };
  while (journal.stage !== 'complete') {
    const stage = journal.stage;
    const interrupted = journal.attempted;
    journal.attempted = true;
    journal.error = '';
    await save();
    try {
      if (stage === 'move') {
        await effects.move(interrupted);
      } else {
        await effects[stage]();
      }
    } catch (error) {
      journal.error = error instanceof Error ? error.message : String(error);
      await save();
      throw error;
    }
    journal.stage = next[stage];
    journal.attempted = false;
    await save();
  }
}
export async function saveGroupJournal(file: string, journal: GroupAdoptionJournal): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(journal, null, JSON_INDENT), { flag: 'wx' });
  await rename(temporary, file);
}
function isGroupJournal(value: unknown): value is GroupAdoptionJournal {
  if (
    !isRecord(value) || value['kind'] !== 'group-adoption' || value['schemaVersion'] !== 1 || typeof value['stage'] !== 'string'
    || !['complete', 'marker', 'move', 'note', 'verify'].includes(value['stage']) || typeof value['attempted'] !== 'boolean'
    || typeof value['error'] !== 'string'
  ) {
    return false;
  }
  for (const key of ['sourceContent', 'preparedContent']) {
    if (value[key] !== null && typeof value[key] !== 'string') {
      return false;
    }
  }
  return isGroupPlan(value['plan']);
}
function isGroupPlan(value: unknown): value is GroupAdoptionPlan {
  if (!isRecord(value)) {
    return false;
  }
  for (const key of ['folderPath', 'vaultRoot', 'externalRoot', 'notePath', 'expectedFolder', 'uuid']) {
    if (typeof value[key] !== 'string') {
      return false;
    }
  }
  if (typeof value['uuid'] !== 'string' || !isCanonicalUuid(value['uuid'])) {
    return false;
  }
  if (value['sourcePath'] !== null && typeof value['sourcePath'] !== 'string') {
    return false;
  }
  if (value['aliases'] !== null && !isStringArray(value['aliases'])) {
    return false;
  }
  if (value['templateExcludePatterns'] !== undefined && !isStringArray(value['templateExcludePatterns'])) {
    return false;
  }
  return typeof value['mutationSequence'] === 'number' && ['ignorePatterns', 'descendants', 'warnings'].every((key) => isStringArray(value[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
/* eslint-enable require-atomic-updates -- Restore the rule after the serialized journal adapter. */
