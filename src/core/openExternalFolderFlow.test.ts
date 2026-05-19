import {
  describe,
  expect,
  it
} from 'vitest';

import { buildExnfMarkerFileName } from './marker.ts';
import { chooseInitialOpenExternalFolderAction } from './openExternalFolderFlow.ts';

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

  it('runs recovery when the expected folder is missing', () => {
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
      kind: 'run-recovery',
      uuid: VALID_UUID
    });
  });

  it('runs recovery before adopting an unmarked expected folder', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'unmarked'
      },
      identity: {
        kind: 'valid',
        uuid: VALID_UUID
      }
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'unmarked'
      },
      kind: 'run-recovery',
      uuid: VALID_UUID
    });
  });

  it('runs recovery when the expected marker is mismatched', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'mismatched-marker',
        markerUuid: OTHER_UUID
      },
      identity: {
        kind: 'valid',
        uuid: VALID_UUID
      }
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'mismatched-marker',
        markerUuid: OTHER_UUID
      },
      kind: 'run-recovery',
      uuid: VALID_UUID
    });
  });

  it('runs recovery when the expected marker is malformed', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'malformed-marker',
        markerPath: `X:/External/Projects/Alpha/${buildExnfMarkerFileName(VALID_UUID)}`,
        message: 'Invalid marker'
      },
      identity: {
        kind: 'valid',
        uuid: VALID_UUID
      }
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'malformed-marker',
        markerPath: `X:/External/Projects/Alpha/${buildExnfMarkerFileName(VALID_UUID)}`,
        message: 'Invalid marker'
      },
      kind: 'run-recovery',
      uuid: VALID_UUID
    });
  });

  it('runs recovery when the expected marker has a legacy conflict', () => {
    expect(chooseInitialOpenExternalFolderAction({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'marker-conflict',
        markerPath: 'X:/External/Projects/Alpha/.exnf',
        message: 'Legacy marker conflicts with UUID-named marker.'
      },
      identity: {
        kind: 'valid',
        uuid: VALID_UUID
      }
    })).toEqual({
      expectedState: {
        folderPath: 'X:/External/Projects/Alpha',
        kind: 'marker-conflict',
        markerPath: 'X:/External/Projects/Alpha/.exnf',
        message: 'Legacy marker conflicts with UUID-named marker.'
      },
      kind: 'run-recovery',
      uuid: VALID_UUID
    });
  });
});
