import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface ObsidianCliResult {
  command: string;
  errorMessage: string;
  status: null | number;
  stderr: string;
  stdout: string;
}

export interface ObsidianVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

export const MINIMUM_OBSIDIAN_VERSION = '1.12.7';

const MINIMUM_VERSION_PARTS = [1, 12, 7] as const;
const RUNTIME_UNAVAILABLE_MARKER = 'unable to find Obsidian';
const WINDOWS_CLI_CANDIDATES = [
  'Obsidian.com',
  'obsidian.com',
  String.raw`${process.env['LOCALAPPDATA'] ?? ''}\Obsidian\Obsidian.com`,
  String.raw`${process.env['USERPROFILE'] ?? ''}\scoop\apps\obsidian\current\Obsidian.com`
].filter((candidate) => candidate.length > 0);

export function assertSupportedObsidianVersion(result: ObsidianCliResult): ObsidianVersion {
  if (result.status !== 0) {
    throw new Error([
      'Obsidian CLI preflight failed.',
      formatObsidianCliResult(result),
      getObsidianCliSetupGuidance()
    ].join('\n'));
  }

  const version = parseObsidianVersion(`${result.stdout}\n${result.stderr}`);
  if (!version) {
    throw new Error([
      `Could not determine the Obsidian version. Version ${MINIMUM_OBSIDIAN_VERSION} or newer is required.`,
      formatObsidianCliResult(result),
      getObsidianCliSetupGuidance()
    ].join('\n'));
  }

  if (!isSupportedObsidianVersion(version)) {
    throw new Error([
      `Obsidian ${version.text} is not supported. Install Obsidian ${MINIMUM_OBSIDIAN_VERSION} or newer.`,
      getObsidianCliSetupGuidance()
    ].join('\n'));
  }

  return version;
}

export function formatObsidianCliResult(result: ObsidianCliResult): string {
  return [
    `command: ${result.command}`,
    `status: ${String(result.status)}`,
    `stdout: ${result.stdout || '<empty>'}`,
    `stderr: ${result.stderr || '<empty>'}`,
    `error: ${result.errorMessage || '<none>'}`
  ].join('\n');
}

export function getObsidianCliSetupGuidance(): string {
  if (isWsl()) {
    return [
      'WSL cannot attach its Linux CLI to the Windows Obsidian process.',
      `Install Obsidian ${MINIMUM_OBSIDIAN_VERSION}+ for Linux inside WSL, run its GUI through WSLg or an X server,`,
      'and enable/register the CLI in that Linux Obsidian installation. Otherwise run this command from Windows.'
    ].join(' ');
  }

  if (process.platform === 'win32') {
    return [
      `Install Obsidian ${MINIMUM_OBSIDIAN_VERSION}+ with the current Windows installer,`,
      'then enable and register the CLI in Settings -> General -> Command line interface.'
    ].join(' ');
  }

  return [
    `Install Obsidian ${MINIMUM_OBSIDIAN_VERSION}+ for this operating system,`,
    'run the desktop app, and enable/register the CLI in Settings -> General -> Command line interface.'
  ].join(' ');
}

export function isRuntimeUnavailable(result: ObsidianCliResult): boolean {
  return [
    result.stdout,
    result.stderr,
    result.errorMessage
  ].join('\n').includes(RUNTIME_UNAVAILABLE_MARKER);
}

export function isSupportedObsidianVersion(version: ObsidianVersion): boolean {
  const versionParts = [version.major, version.minor, version.patch];
  for (const [index, minimumPart] of MINIMUM_VERSION_PARTS.entries()) {
    const versionPart = versionParts[index] ?? 0;
    if (versionPart > minimumPart) {
      return true;
    }
    if (versionPart < minimumPart) {
      return false;
    }
  }
  return true;
}

export function isWsl(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) {
    return true;
  }

  try {
    return readFileSync('/proc/sys/kernel/osrelease', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

export function parseObsidianVersion(output: string): null | ObsidianVersion {
  /*
   * Prefer a version explicitly labeled "Obsidian x.y.z" so noisy CLI output that also reports an
   * installer/Electron version cannot be mistaken for the app version. Fall back to the first bare
   * semver when no labeled version is present.
   */
  const match = /Obsidian\s+v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)\b/iu.exec(output)
    ?? /\b(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)\b/u.exec(output);
  if (!match?.groups) {
    return null;
  }

  const major = Number(match.groups['major']);
  const minor = Number(match.groups['minor']);
  const patch = Number(match.groups['patch']);
  return {
    major,
    minor,
    patch,
    text: `${String(major)}.${String(minor)}.${String(patch)}`
  };
}

export function runObsidianCli(
  args: readonly string[],
  cwd: string,
  timeoutMilliseconds: number
): ObsidianCliResult {
  const candidates = getObsidianCliCandidates();

  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMilliseconds
    });
    const output: ObsidianCliResult = {
      command: `${candidate} ${args.join(' ')}`.trim(),
      errorMessage: result.error?.message ?? '',
      status: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim()
    };

    if (!isMissingExecutableError(result.error)) {
      return output;
    }
  }

  return {
    command: `${candidates.join(' OR ')} ${args.join(' ')}`.trim(),
    errorMessage: 'No Obsidian CLI binary found in configured/default locations.',
    status: null,
    stderr: '',
    stdout: ''
  };
}

function getObsidianCliCandidates(): string[] {
  const configured = process.env['OBSIDIAN_CLI_BIN']?.trim();
  if (configured) {
    return [configured];
  }

  if (process.platform === 'win32') {
    return WINDOWS_CLI_CANDIDATES;
  }

  return ['obsidian'];
}

function isMissingExecutableError(error?: Error): boolean {
  return error !== undefined
    && 'code' in error
    && error.code === 'ENOENT';
}
