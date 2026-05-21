import type {
  App,
  TFile
} from 'obsidian';

import { parseYaml } from 'obsidian';

import {
  getExnfFrontmatterValue,
  setExnfFrontmatterValue
} from '../core/frontmatter.ts';

export async function assertNoteUuidMatches(app: App, file: TFile, uuid: string): Promise<void> {
  const frontmatter = parseMarkdownFrontmatter(await app.vault.read(file));
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

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function parseMarkdownFrontmatter(markdown: string): Record<string, unknown> | undefined {
  const match = /^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  if (!match) {
    return undefined;
  }

  const parsedYaml: unknown = parseYaml(match.groups?.['frontmatter'] ?? '');
  return isRecord(parsedYaml) ? parsedYaml : {};
}
