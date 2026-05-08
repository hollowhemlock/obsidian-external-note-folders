import type {
  App,
  TFile
} from 'obsidian';

import {
  getExnfFrontmatterValue,
  setExnfFrontmatterValue
} from '../core/frontmatter.ts';

export function assertNoteUuidMatches(app: App, file: TFile, uuid: string): void {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;
  const currentValue = getExnfFrontmatterValue(frontmatter);
  if (currentValue.kind === 'valid' && currentValue.uuid === uuid) {
    return;
  }

  if (currentValue.kind === 'valid') {
    throw new Error(`Note is bound to UUID ${currentValue.uuid}, expected ${uuid}.`);
  }

  if (currentValue.kind === 'missing') {
    throw new Error(`Note is missing expected UUID ${uuid}.`);
  }

  throw new Error(`Cannot verify note UUID because exnf frontmatter ${currentValue.reason}.`);
}

export async function writeUuidToNoteIfMissing(app: App, file: TFile, uuid: string): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const currentValue = getExnfFrontmatterValue(frontmatter as Record<string, unknown>);
    if (currentValue.kind === 'missing') {
      setExnfFrontmatterValue(frontmatter as Record<string, unknown>, uuid);
      return;
    }

    if (currentValue.kind === 'valid' && currentValue.uuid === uuid) {
      return;
    }

    if (currentValue.kind === 'valid') {
      throw new Error(`Note is already bound to UUID ${currentValue.uuid}.`);
    }

    throw new Error(`Cannot write UUID because exnf frontmatter ${currentValue.reason}.`);
  });
}
