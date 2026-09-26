import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ReleaseMetadata {
  minAppVersion: string;
  version: string;
}

export function checkMetadata(root: string): ReleaseMetadata {
  function read(name: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path.join(root, name), 'utf8')) as Record<string, unknown>;
  }
  const manifest = read('manifest.json');
  const version = stableVersion(manifest['version']);
  const lock = read('package-lock.json');
  const packages = lock['packages'] as Record<string, Record<string, unknown>> | undefined;
  const versions: Record<string, unknown> = {
    '.github/.release-please-manifest.json': read('.github/.release-please-manifest.json')['.'],
    'package-lock.json': lock['version'],
    'package-lock.json packages[""]': packages?.['']?.['version'],
    'package.json': read('package.json')['version']
  };
  for (const [file, actual] of Object.entries(versions)) {
    if (actual !== version) {
      throw new Error(`${file}: expected ${version}, found ${String(actual)}. Synchronize Release Please metadata; do not bump individual files.`);
    }
  }
  const minAppVersion = stableVersion(manifest['minAppVersion']);
  if (read('versions.json')[version] !== minAppVersion) {
    throw new Error(`versions.json must map ${version} to ${minAppVersion}.`);
  }
  return { minAppVersion, version };
}

export function compareStable(left: string, right: string): number {
  const a = stableVersion(left).split('.').map(BigInt);
  const b = stableVersion(right).split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) {
      return (a[index] ?? 0n) > (b[index] ?? 0n) ? 1 : -1;
    }
  }
  return 0;
}

export function requireBetaVersion(beta: string, stable: string): void {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(beta);
  if (!match?.[4] || match[4].split('.').some((part) => /^\d+$/.test(part) && /^0\d/.test(part))) {
    throw new Error(`Invalid semantic prerelease version: ${beta}.`);
  }
  if (compareStable(match.slice(1, 4).join('.'), stable) <= 0) {
    throw new Error(`Prerelease ${beta} must be newer than stable ${stable}.`);
  }
}

export function stableVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Expected a stable semantic version, received ${String(value)}.`);
  }
  return value;
}
