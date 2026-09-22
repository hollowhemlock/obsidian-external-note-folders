import type { OpenExternalFolderRecoveryPlan } from './core/openExternalFolderRecovery.ts';
import type { ModalDetail } from './modalDetails.ts';

import { buildExnfMarkerFileName } from './core/marker.ts';

type RecoveryContext = Pick<OpenExternalFolderRecoveryPlan, 'expectedState' | 'externalRootPath' | 'notePath' | 'uuid'>;

export const RECOVERY_SEARCH_DESCRIPTION =
  'Searching the external root for a matching .exnf marker file to locate this note’s folder. The search also checks older .exnf markers and folders with the expected name.';

export const RECOVERY_SEARCH_FOOTER =
  'The search follows your configured ignores and checks for duplicate matches before opening a folder. Broad external roots can take longer. This window will close when the search finishes.';

export function buildRecoveryDetails(input: RecoveryContext, rootLabel: string): ModalDetail[] {
  return [
    { label: 'Note', value: input.notePath },
    { label: 'Expected folder', value: input.expectedState.folderPath },
    { label: rootLabel, value: input.externalRootPath },
    { label: 'Marker filename', value: buildExnfMarkerFileName(input.uuid) }
  ];
}

export function describeRecoveryOutcome(plan: OpenExternalFolderRecoveryPlan, openedFolderPath: null | string): string {
  if (plan.errors.length > 0) {
    return 'Recovery is blocked by scan errors. Resolve the errors below before opening or associating a folder.';
  }
  if (plan.activeMatches.length > 1) {
    return 'Multiple folders contain this note’s UUID. Resolve the duplicate matches below before opening a folder.';
  }
  if (plan.activeMatches.length === 1) {
    return openedFolderPath === plan.activeMatches[0]?.folderPath
      ? 'A matching external folder was found and opened.'
      : 'A matching external folder was found. You can open it below.';
  }
  return plan.candidateRows.length > 0
    ? 'No matching .exnf marker was found in the folders checked. Folders with the same name were found; review their markers and ownership before associating one with this note.'
    : 'No matching .exnf marker or folder with the expected name was found in the folders checked. Review the available actions below.';
}

export function describeRecoveryReason(state: RecoveryContext['expectedState']): string {
  switch (state.kind) {
    case 'malformed-marker':
      return 'The expected folder contains a marker that could not be interpreted.';
    case 'marker-conflict':
      return 'The expected folder contains conflicting marker identifiers.';
    case 'mismatched-marker':
      return 'The expected folder contains a marker with a different identifier.';
    case 'missing':
      return 'The external folder was not found at its expected location.';
    case 'unmarked':
      return 'The expected folder exists, but it has no .exnf marker identifying this note’s folder.';
    default:
      throw new Error('Unexpected recovery state.');
  }
}
