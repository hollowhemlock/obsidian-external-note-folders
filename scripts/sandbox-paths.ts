import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

export const SANDBOX_VAULT_RELATIVE_PATH = 'test/fixtures/sandbox/vault';
export const SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/sandbox/external-root';
export const SANDBOX_REPORTS_RELATIVE_PATH = 'test/fixtures/sandbox/reports';

export interface SandboxPaths {
  externalRootPath: string;
  obsidianConfigPath: string;
  source: 'current' | 'linked-worktree';
  vaultPath: string;
  worktreePath: string;
}

const SANDBOX_CONFIG_RELATIVE_PATH = `${SANDBOX_VAULT_RELATIVE_PATH}/.obsidian`;

export function getAdditionalObsidianConfigFoldersFromEnv(): string[] {
  return uniqueResolvedPaths([
    process.env['OBSIDIAN_CONFIG_FOLDER'],
    ...splitEnvPaths(process.env['OBSIDIAN_CONFIG_FOLDERS'])
  ]);
}

export function getCurrentSandboxPaths(): SandboxPaths {
  return getSandboxPathsForWorktree(getProjectRoot(), 'current');
}

export function getExistingLinkedWorktreeSandboxPaths(): SandboxPaths[] {
  return getLinkedWorktreeSandboxPaths()
    .filter((sandboxPaths) => existsSync(sandboxPaths.obsidianConfigPath));
}

export function getExistingSandboxPaths(): SandboxPaths[] {
  return uniqueSandboxPaths([
    getCurrentSandboxPaths(),
    ...getExistingLinkedWorktreeSandboxPaths()
  ]);
}

export function getLinkedWorktreeSandboxPaths(): SandboxPaths[] {
  const currentWorktreePath = getProjectRoot();
  return uniqueSandboxPaths(
    getGitWorktreePaths(currentWorktreePath)
      .filter((worktreePath) => !isSamePath(worktreePath, currentWorktreePath))
      .map((worktreePath) => getSandboxPathsForWorktree(worktreePath, 'linked-worktree'))
  );
}

export function isSamePath(leftPath: string, rightPath: string): boolean {
  return getPathKey(leftPath) === getPathKey(rightPath);
}

export function resolveProjectPath(relativePath: string): string {
  return resolvePathFromRoot(relativePath) ?? path.resolve(process.cwd(), relativePath);
}

export function uniqueResolvedPaths(paths: readonly (string | undefined)[]): string[] {
  const result: string[] = [];
  const seenPathKeys = new Set<string>();
  for (const inputPath of paths) {
    const trimmedPath = inputPath?.trim();
    if (!trimmedPath) {
      continue;
    }

    const resolvedPath = path.resolve(trimmedPath);
    const pathKey = getPathKey(resolvedPath);
    if (seenPathKeys.has(pathKey)) {
      continue;
    }

    result.push(resolvedPath);
    seenPathKeys.add(pathKey);
  }

  return result;
}

function getGitWorktreePaths(cwd: string): string[] {
  try {
    const output = execFileSync(
      'git',
      [
        'worktree',
        'list',
        '--porcelain'
      ],
      {
        cwd,
        encoding: 'utf8',
        stdio: [
          'ignore',
          'pipe',
          'ignore'
        ]
      }
    );
    return output
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
  } catch {
    return [];
  }
}

function getPathKey(inputPath: string): string {
  const resolvedPath = path.resolve(inputPath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function getProjectRoot(): string {
  return path.dirname(resolveProjectPath('package.json'));
}

function getSandboxPathsForWorktree(worktreePath: string, source: SandboxPaths['source']): SandboxPaths {
  return {
    externalRootPath: path.join(worktreePath, SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH),
    obsidianConfigPath: path.join(worktreePath, SANDBOX_CONFIG_RELATIVE_PATH),
    source,
    vaultPath: path.join(worktreePath, SANDBOX_VAULT_RELATIVE_PATH),
    worktreePath
  };
}

function splitEnvPaths(input?: string): string[] {
  return input?.split(',') ?? [];
}

function uniqueSandboxPaths(sandboxPaths: readonly SandboxPaths[]): SandboxPaths[] {
  const result: SandboxPaths[] = [];
  const seenPathKeys = new Set<string>();
  for (const sandboxPath of sandboxPaths) {
    const pathKey = getPathKey(sandboxPath.obsidianConfigPath);
    if (seenPathKeys.has(pathKey)) {
      continue;
    }

    result.push(sandboxPath);
    seenPathKeys.add(pathKey);
  }

  return result;
}
