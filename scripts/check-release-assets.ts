import { stat } from 'node:fs/promises';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

const REQUIRED_RELEASE_ASSETS = [
  'dist/build/main.js',
  'dist/build/manifest.json',
  'dist/build/styles.css'
] as const;

async function assertFileExists(relativePath: string): Promise<void> {
  const fileStat = await stat(getAbsolutePath(relativePath));
  if (!fileStat.isFile()) {
    throw new Error(`Release asset is not a file: ${relativePath}`);
  }
}

function getAbsolutePath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

async function main(): Promise<void> {
  for (const relativePath of REQUIRED_RELEASE_ASSETS) {
    await assertFileExists(relativePath);
  }
}

// eslint-disable-next-line no-void -- top-level entry point
void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
