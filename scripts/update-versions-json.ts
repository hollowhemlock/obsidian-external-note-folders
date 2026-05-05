import {
  readFile,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

const JSON_INDENT = 2;
const MANIFEST_RELATIVE_PATH = 'manifest.json';
const VERSIONS_RELATIVE_PATH = 'versions.json';

interface Manifest {
  minAppVersion?: unknown;
  version?: unknown;
}

async function buildVersionsJson(): Promise<string> {
  const manifest = await readJsonFile(getAbsolutePath(MANIFEST_RELATIVE_PATH)) as Manifest;
  const version = requireString(manifest.version, 'manifest.json version');
  const minAppVersion = requireString(manifest.minAppVersion, 'manifest.json minAppVersion');

  const versionsPath = getAbsolutePath(VERSIONS_RELATIVE_PATH);
  const rawVersions = await readJsonFile(versionsPath);
  if (!isRecord(rawVersions)) {
    throw new Error('versions.json must contain a JSON object.');
  }

  const versions: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawVersions)) {
    versions[key] = requireString(value, `versions.json entry ${key}`);
  }
  versions[version] = minAppVersion;

  return `${JSON.stringify(sortVersions(versions), null, JSON_INDENT)}\n`;
}

function getAbsolutePath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const versionsPath = getAbsolutePath(VERSIONS_RELATIVE_PATH);
  const nextContent = await buildVersionsJson();
  const currentContent = await readFile(versionsPath, 'utf8');

  if (checkOnly) {
    if (currentContent !== nextContent) {
      throw new Error('versions.json is stale. Run `npm run release:update-versions` and commit the result.');
    }
    return;
  }

  await writeFile(versionsPath, nextContent, 'utf8');
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function sortVersions(versions: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(versions).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
  );
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
