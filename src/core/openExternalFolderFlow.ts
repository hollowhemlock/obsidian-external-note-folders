import type { ExnfFrontmatterValue } from './frontmatter.ts';

export type ExpectedExternalFolderState =
  | { folderPath: string; kind: 'bound' }
  | { folderPath: string; kind: 'malformed-marker'; markerPath: string; message: string }
  | { folderPath: string; kind: 'mismatched-marker'; markerUuid: string }
  | { folderPath: string; kind: 'missing' }
  | { folderPath: string; kind: 'unmarked' };

export type InitialOpenExternalFolderAction =
  | { expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound' }>; kind: 'scan-fallback'; uuid: string }
  | { folderPath: string; kind: 'open-expected'; uuid: string }
  | { kind: 'block-invalid-identity'; message: string }
  | { kind: 'notice-missing-identity' };

export type OpenExternalFolderFallbackAction =
  | { expectedState: Extract<ExpectedExternalFolderState, { kind: 'malformed-marker' | 'mismatched-marker' }>; kind: 'block-expected-marker'; uuid: string }
  | { folderPath: string; kind: 'create-expected'; uuid: string }
  | { folderPath: string; kind: 'open-drifted'; uuid: string }
  | { folderPath: string; kind: 'prompt-adopt-expected'; uuid: string }
  | { kind: 'block-integrity-errors'; uuid: string };

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
      folderPath: input.expectedState.folderPath,
      kind: 'open-expected',
      uuid: input.identity.uuid
    };
  }

  return {
    expectedState: input.expectedState,
    kind: 'scan-fallback',
    uuid: input.identity.uuid
  };
}

export function chooseOpenExternalFolderFallbackAction(input: {
  expectedState: Exclude<ExpectedExternalFolderState, { kind: 'bound' }>;
  hasIntegrityErrors: boolean;
  matchingFolderPath: null | string;
  uuid: string;
}): OpenExternalFolderFallbackAction {
  if (input.matchingFolderPath) {
    return {
      folderPath: input.matchingFolderPath,
      kind: 'open-drifted',
      uuid: input.uuid
    };
  }

  if (input.hasIntegrityErrors) {
    return {
      kind: 'block-integrity-errors',
      uuid: input.uuid
    };
  }

  if (input.expectedState.kind === 'missing') {
    return {
      folderPath: input.expectedState.folderPath,
      kind: 'create-expected',
      uuid: input.uuid
    };
  }

  if (input.expectedState.kind === 'unmarked') {
    return {
      folderPath: input.expectedState.folderPath,
      kind: 'prompt-adopt-expected',
      uuid: input.uuid
    };
  }

  return {
    expectedState: input.expectedState,
    kind: 'block-expected-marker',
    uuid: input.uuid
  };
}
