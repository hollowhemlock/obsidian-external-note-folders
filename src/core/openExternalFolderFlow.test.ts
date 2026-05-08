import {
  describe,
  expect,
  it
} from 'vitest';

import {
  chooseInitialOpenExternalFolderAction,
  chooseOpenExternalFolderFallbackAction
} from './openExternalFolderFlow.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_UUID = '123e4567-e89b-42d3-a456-426614174001';

describe('open external folder flow', () => {
  it('does not inspect or scan external folders when identity is missing', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: null,
      identity: { kind: 'missing' }
    })).toEqual({ kind: 'notice-missing-identity' });
  });

  it('blocks invalid identity before expected folder inspection is required', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: null,
      identity: {
        kind: 'invalid',
        reason: 'is not a canonical UUID',
        value: 'not-a-uuid'
      }
    })).toEqual({
      kind: 'block-invalid-identity',
      message: 'Cannot open external folder because exnf frontmatter is not a canonical UUID.'
    });
  });

  it('opens the expected folder without fallback scan when it is already bound', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'bound'
      },
      identity: {
        kind: 'valid',
        uuid: VALID_UUID
      }
    })).toEqual({
      folderPath: 'X:/External/Projects/Alpha',
      kind: 'open-expected',
      uuid: VALID_UUID
    });
  });

  it('falls back to an external scan when the expected folder is not already bound', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'missing'
      },
      identity: {
        kind: 'valid',
        uuid: VALID_UUID
      }
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'missing'
      },
      kind: 'scan-fallback',
      uuid: VALID_UUID
    });
  });

  it('opens a matching bound folder found elsewhere before creating or adopting expected folders', () => {
    expect(chooseOpenExternalFolderFallbackAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'missing'
      },
      hasIntegrityErrors: false,
      matchingFolderPath: 'X:/External/Old/Alpha',
      uuid: VALID_UUID
    })).toEqual({
      folderPath: 'X:/External/Old/Alpha',
      kind: 'open-drifted',
      uuid: VALID_UUID
    });
  });

  it('creates a missing expected folder only when no matching uuid is found elsewhere', () => {
    expect(chooseOpenExternalFolderFallbackAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'missing'
      },
      hasIntegrityErrors: false,
      matchingFolderPath: null,
      uuid: VALID_UUID
    })).toEqual({
      folderPath: 'X:/External/Projects/Alpha',
      kind: 'create-expected',
      uuid: VALID_UUID
    });
  });

  it('prompts before adopting an unmarked expected folder', () => {
    expect(chooseOpenExternalFolderFallbackAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'unmarked'
      },
      hasIntegrityErrors: false,
      matchingFolderPath: null,
      uuid: VALID_UUID
    })).toEqual({
      folderPath: 'X:/External/Projects/Alpha',
      kind: 'prompt-adopt-expected',
      uuid: VALID_UUID
    });
  });

  it('blocks mismatched expected markers when no matching uuid is found elsewhere', () => {
    expect(chooseOpenExternalFolderFallbackAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'mismatched-marker',
        markerUuid: OTHER_UUID
      },
      hasIntegrityErrors: false,
      matchingFolderPath: null,
      uuid: VALID_UUID
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'mismatched-marker',
        markerUuid: OTHER_UUID
      },
      kind: 'block-expected-marker',
      uuid: VALID_UUID
    });
  });

  it('blocks malformed expected markers when no matching uuid is found elsewhere', () => {
    expect(chooseOpenExternalFolderFallbackAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'malformed-marker',
        markerPath: 'X:/External/Projects/Alpha/.exnf',
        message: 'Invalid marker'
      },
      hasIntegrityErrors: false,
      matchingFolderPath: null,
      uuid: VALID_UUID
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'malformed-marker',
        markerPath: 'X:/External/Projects/Alpha/.exnf',
        message: 'Invalid marker'
      },
      kind: 'block-expected-marker',
      uuid: VALID_UUID
    });
  });
});
