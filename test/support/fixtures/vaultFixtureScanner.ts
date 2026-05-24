import {
  readdir,
  readFile
} from 'node:fs/promises';
import path from 'node:path';

import type { VaultScanResult } from '../../../src/core/verify.ts';

import { getExnfFrontmatterValue } from '../../../src/core/frontmatter.ts';
import { registerUuidBinding } from '../../../src/core/scanResult.ts';

export async function scanFixtureVault(input: {
  relativeScenarioPath: string;
  vaultRootPath: string;
}): Promise<VaultScanResult> {
  const bindings = new Map<string, string>();
  const duplicatePaths = new Map<string, string[]>();
  const invalidFrontmatter: VaultScanResult['invalidFrontmatter'] = [];
  const scenarioRootPath = path.join(input.vaultRootPath, input.relativeScenarioPath);

  for (const filePath of await listMarkdownFiles(scenarioRootPath)) {
    const notePath = toVaultRelativePath(input.vaultRootPath, filePath);
    const frontmatter = parseFrontmatter(await readFile(filePath, 'utf8'));
    const exnfValue = getExnfFrontmatterValue(frontmatter);
    if (exnfValue.kind === 'missing') {
      continue;
    }

    if (exnfValue.kind === 'invalid') {
      invalidFrontmatter.push({
        location: notePath,
        message: `${exnfValue.reason}.`
      });
      continue;
    }

    registerUuidBinding(bindings, duplicatePaths, exnfValue.uuid, notePath);
  }

  return {
    bindings,
    duplicatePaths,
    invalidFrontmatter: invalidFrontmatter.sort((left, right) => left.location.localeCompare(right.location))
  };
}

async function listMarkdownFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
  const normalizedContent = content.replaceAll('\r\n', '\n');
  if (!normalizedContent.startsWith('---\n')) {
    return undefined;
  }

  const endIndex = normalizedContent.indexOf('\n---', 4);
  if (endIndex === -1) {
    return undefined;
  }

  const frontmatter: Record<string, unknown> = {};
  const frontmatterText = normalizedContent.slice(4, endIndex);
  for (const line of frontmatterText.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      frontmatter[key] = stripYamlStringQuotes(value);
    }
  }

  return frontmatter;
}

function stripYamlStringQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function toVaultRelativePath(vaultRootPath: string, filePath: string): string {
  return path.relative(vaultRootPath, filePath).replaceAll(path.sep, '/');
}
