import type { ExnfFrontmatterValue } from './frontmatter.ts';

export type ExpectedExternalFolderState =
  | { additionalMarkerUuids: string[]; folderPath: string; kind: 'bound-with-additional-markers' }
  | { folderPath: string; kind: 'bound' }
  | { folderPath: string; kind: 'malformed-marker'; markerPath: string; message: string }
  | { folderPath: string; kind: 'marker-conflict'; markerPath: string; message: string }
  | { folderPath: string; kind: 'mismatched-marker'; markerUuid: string }
  | { folderPath: string; kind: 'missing' }
  | { folderPath: string; kind: 'unmarked' };

export type InitialOpenExternalFolderAction =
  | { additionalMarkerUuids: string[]; folderPath: string; kind: 'open-expected'; uuid: string }
  | { expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound-with-additional-markers' | 'bound' }>; kind: 'run-recovery'; uuid: string }
  | { kind: 'block-invalid-identity'; message: string }
  | { kind: 'notice-missing-identity' };

export function chooseInitialOpenExternalFolderAction(input: {
  expectedState: ExpectedExternalFolderState | null;
  identity: ExnfFrontmatterValue;
}): InitialOpenExternalFolderAction {
  if (input.identity.kind === 'missing') {
    return { kind: 'notice-missing-identity' };
  }

  if (input.identity.kind === 'invalid') {
    return {
      kind: 'block-invalid-identity',
      message: `Cannot open external folder because exnf frontmatter ${input.identity.reason}.`
    };
  }

  if (!input.expectedState) {
    throw new Error('Expected folder state is required for notes with exnf.');
  }

  if (input.expectedState.kind === 'bound') {
    return {
      additionalMarkerUuids: [],
      folderPath: input.expectedState.folderPath,
      kind: 'open-expected',
      uuid: input.identity.uuid
    };
  }

  if (input.expectedState.kind === 'bound-with-additional-markers') {
    return {
      additionalMarkerUuids: input.expectedState.additionalMarkerUuids,
      folderPath: input.expectedState.folderPath,
      kind: 'open-expected',
      uuid: input.identity.uuid
    };
  }

  if (input.expectedState.kind === 'missing') {
    return {
      expectedState: input.expectedState,
      kind: 'run-recovery',
      uuid: input.identity.uuid
    };
  }

  if (input.expectedState.kind === 'unmarked') {
    return {
      expectedState: input.expectedState,
      kind: 'run-recovery',
      uuid: input.identity.uuid
    };
  }

  return {
    expectedState: input.expectedState,
    kind: 'run-recovery',
    uuid: input.identity.uuid
  };
}
