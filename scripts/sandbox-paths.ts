import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolvePathFromRoot } from 'obsidian-dev-utils/ScriptUtils/Root';

export const SANDBOX_VAULT_RELATIVE_PATH = 'test/fixtures/sandbox/plugin-external-note-folders-sandbox';
export const SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH = 'test/fixtures/sandbox/external-root';
export const SANDBOX_REPORTS_RELATIVE_PATH = 'test/fixtures/sandbox/reports';

export interface SandboxPaths {
  externalRootPath: string;
  obsidianConfigPath: string;
  vaultPath: string;
}

const SANDBOX_CONFIG_RELATIVE_PATH = `${SANDBOX_VAULT_RELATIVE_PATH}/.obsidian`;

export function assertPrimaryCheckout(operation: string): void {
  const projectRoot = getProjectRoot();
  const gitDirectory = resolveGitDirectory(projectRoot, '--git-dir');
  const commonGitDirectory = resolveGitDirectory(projectRoot, '--git-common-dir');
  if (isSamePath(gitDirectory, commonGitDirectory)) {
    return;
  }

  throw new Error(
    `${operation} must run from the primary Git checkout, not a linked worktree.\n`
      + `Current worktree: ${projectRoot}\n`
      + `Primary checkout: ${path.dirname(commonGitDirectory)}`
  );
}

export function getAdditionalObsidianConfigFoldersFromEnv(): string[] {
  return uniqueResolvedPaths([
    process.env['OBSIDIAN_CONFIG_FOLDER'],
    ...splitEnvPaths(process.env['OBSIDIAN_CONFIG_FOLDERS'])
  ]);
}

export function getCurrentSandboxPaths(): SandboxPaths {
  const projectRoot = getProjectRoot();
  return {
    externalRootPath: path.join(projectRoot, SANDBOX_EXTERNAL_ROOT_RELATIVE_PATH),
    obsidianConfigPath: path.join(projectRoot, SANDBOX_CONFIG_RELATIVE_PATH),
    vaultPath: path.join(projectRoot, SANDBOX_VAULT_RELATIVE_PATH)
  };
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

function getPathKey(inputPath: string): string {
  const resolvedPath = path.resolve(inputPath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function getProjectRoot(): string {
  return path.dirname(resolveProjectPath('package.json'));
}

function resolveGitDirectory(cwd: string, argument: '--git-common-dir' | '--git-dir'): string {
  const output = execFileSync(
    'git',
    [
      'rev-parse',
      argument
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: [
        'ignore',
        'pipe',
        'pipe'
      ]
    }
  ).trim();
  return path.resolve(cwd, output);
}

function splitEnvPaths(input?: string): string[] {
  return input?.split(',') ?? [];
}
