import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { ExternalScanResult } from './verify.ts';

import { getActiveFolderDrift } from './activeFolderDrift.ts';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('active folder drift', () => {
  it('reports only the active UUID when its bound folder is not at the expected path', () => {
    const externalRootPath = path.resolve('external-root');
    const externalScan = buildExternalScan(externalRootPath, path.join(externalRootPath, 'Notes', 'Old Name'));

    expect(getActiveFolderDrift({
      externalScan,
      notePath: 'Notes/New Name.md',
      uuid: UUID
    })).toEqual({
      actualExternalFolder: 'Notes/Old Name',
      expectedExternalFolder: 'Notes/New Name',
      notePath: 'Notes/New Name.md',
      uuid: UUID
    });
  });

  it('does not report drift when the active UUID is unbound or already correct', () => {
    const externalRootPath = path.resolve('external-root');

    expect(getActiveFolderDrift({
      externalScan: buildExternalScan(externalRootPath, path.join(externalRootPath, 'Notes', 'New Name')),
      notePath: 'Notes/New Name.md',
      uuid: UUID
    })).toBeNull();
    expect(getActiveFolderDrift({
      externalScan: buildExternalScan(externalRootPath, null),
      notePath: 'Notes/New Name.md',
      uuid: UUID
    })).toBeNull();
  });
});

function buildExternalScan(externalRootPath: string, boundPath: null | string): ExternalScanResult {
  return {
    accessErrors: [],
    bindings: boundPath ? new Map([[UUID, boundPath]]) : new Map(),
    directories: [],
    duplicatePaths: new Map(),
    malformedMarkers: [],
    rootPath: externalRootPath,
    skippedDirectories: []
  };
}
