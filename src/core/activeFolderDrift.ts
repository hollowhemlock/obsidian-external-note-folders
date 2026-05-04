import type { ExternalScanResult } from './verify.ts';

import { toExternalRelativeDisplayPath } from './displayPath.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';

export interface ActiveFolderDrift {
  actualExternalFolder: string;
  expectedExternalFolder: string;
  notePath: string;
  uuid: string;
}

export function getActiveFolderDrift(input: {
  externalScan: ExternalScanResult;
  notePath: string;
  uuid: string;
}): ActiveFolderDrift | null {
  const actualFolderPath = input.externalScan.bindings.get(input.uuid);
  if (!actualFolderPath) {
    return null;
  }

  const expectedFolderPath = deriveExternalFolderPath(input.notePath, input.externalScan.rootPath);
  if (normalizePathForIdentity(actualFolderPath) === normalizePathForIdentity(expectedFolderPath)) {
    return null;
  }

  return {
    actualExternalFolder: toExternalRelativeDisplayPath(input.externalScan.rootPath, actualFolderPath),
    expectedExternalFolder: toExternalRelativeDisplayPath(input.externalScan.rootPath, expectedFolderPath),
    notePath: input.notePath,
    uuid: input.uuid
  };
}
