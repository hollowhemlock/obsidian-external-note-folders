import type {
  App,
  TFile
} from 'obsidian';

import {
  getExnfFrontmatterValue,
  setExnfFrontmatterValue
} from '../core/frontmatter.ts';
import {
  generateCanonicalUuid,
  generateUnusedCanonicalUuid
} from '../core/uuid.ts';

export interface AssignUuidOptions {
  existingUuids?: ReadonlySet<string>;
  generateUuid?: () => string;
}

export type AssignUuidOutcome =
  | { kind: 'assigned'; uuid: string }
  | { kind: 'existing'; uuid: string };

export async function assignUuidToNote(app: App, file: TFile, options: AssignUuidOptions = {}): Promise<AssignUuidOutcome> {
  let outcome: AssignUuidOutcome | undefined;

  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    const currentValue = getExnfFrontmatterValue(frontmatter as Record<string, unknown>);
    if (currentValue.kind === 'missing') {
      const uuid = generateUnusedCanonicalUuid(options.existingUuids ?? new Set(), options.generateUuid ?? generateCanonicalUuid);
      setExnfFrontmatterValue(frontmatter as Record<string, unknown>, uuid);
      outcome = {
        kind: 'assigned',
        uuid
      };
      return;
    }

    if (currentValue.kind === 'valid') {
      outcome = {
        kind: 'existing',
        uuid: currentValue.uuid
      };
      return;
    }

    throw new Error(`Cannot assign UUID because exnf frontmatter ${currentValue.reason}.`);
  });

  if (!outcome) {
    throw new Error(`Unable to assign a UUID to ${file.path}.`);
  }

  return outcome;
}
