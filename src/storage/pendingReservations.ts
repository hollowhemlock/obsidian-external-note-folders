import type { IncompleteAdoptionJournal } from './adoptionExecutor.ts';
import type { SetupJournal } from './setupExecutor.ts';

import { pathsOverlap } from '../core/groupAdoption.ts';
import { readAdoptionJournal } from './adoptionExecutor.ts';
import { readGroupJournal } from './groupAdoptionJournal.ts';

// Callers select and list journal families in workflow order.
// Preserve eager validation and sequential rereads: both affect which failure is reported.
export async function assertNoPendingBulkAdoption(folder: string, journals: readonly IncompleteAdoptionJournal[]): Promise<void> {
  for (const item of journals) {
    const journal = await readAdoptionJournal(item.journalPath);
    if (journal.entries.some((entry) => entry.completedAt === null && pathsOverlap(folder, entry.folderPath))) {
      throw new Error(`Review pending bulk adoption: ${item.journalPath}`);
    }
  }
}

export async function assertNoPendingGroupAdoption(
  targets: readonly string[],
  files: readonly string[],
  message: string,
  except?: string
): Promise<void> {
  for (const file of files) {
    if (file === except) {
      continue;
    }
    const journal = await readGroupJournal(file);
    if (targets.some((target) => [journal.plan.folderPath, journal.plan.expectedFolder].some((candidate) => pathsOverlap(target, candidate)))) {
      throw new Error(`${message}: ${file}`);
    }
  }
}

export function assertNoPendingSetup(
  folder: string,
  journals: readonly ({ journalPath: string } & SetupJournal)[],
  message: string,
  except?: string
): void {
  for (const journal of journals) {
    if (journal.journalPath !== except && pathsOverlap(folder, journal.targetPath)) {
      throw new Error(`${message}: ${journal.journalPath}`);
    }
  }
}
