import {
  execFile,
  spawn
} from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const QUERY_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT = 67_108_864;
const RECORD_FIELDS = 4;

interface GitCommandFailure {
  code: null | number | string | undefined;
  diagnostic: string;
  killed: boolean | undefined;
  signal: null | string | undefined;
  stage: 'index' | 'repository' | 'version';
}

/** Fatal unless explicitly classified as pre-scan repository validation. */
export class GitFilteringError extends Error {
  public constructor(public readonly root: string, reason: string, public readonly command?: GitCommandFailure) {
    super(`Git filtering failed for ${root}: ${reason}`);
  }
}

export class GitIgnoreRepository {
  private buffer = '';
  private readonly child;
  private readonly closed: Promise<void>;
  private ending = false;
  private failure: Error | undefined;
  private finished = false;
  private pending: { reject: (error: Error) => void; resolve: (reason: null | string) => void; target: string } | undefined;
  private readonly prefixes = new Set<string>();
  public constructor(public readonly root: string, tracked: string[], private readonly signal?: AbortSignal) {
    for (const file of tracked) {
      let prefix = file;
      while (prefix.includes('/')) {
        prefix = prefix.slice(0, prefix.lastIndexOf('/'));
        this.prefixes.add(this.key(prefix));
      }
      // Gitlinks also protect the submodule directory itself.
      this.prefixes.add(this.key(file));
    }
    this.child = spawn('git', ['-C', root, 'check-ignore', '--stdin', '-z', '--verbose', '--non-matching', '--no-index'], {
      env: gitEnvironment(),
      stdio: 'pipe',
      windowsHide: true
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.receive(chunk);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.fail(chunk.trim());
    });
    this.child.on('error', (error) => {
      this.fail(error.message);
    });
    this.child.stdin.on('error', (error) => {
      this.fail(error.message);
    });
    this.closed = new Promise<void>((resolve) => {
      this.child.on('close', (code) => {
        if (!this.finished && (!this.ending || (code !== 0 && code !== 1) || this.buffer || this.pending)) {
          this.fail(`Ignore process ended unexpectedly (${String(code)}).`);
        }
        resolve();
      });
    });
    signal?.addEventListener('abort', this.abort, { once: true });
  }

  public dispose(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.signal?.removeEventListener('abort', this.abort);
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(new GitFilteringError(this.root, 'Ignore query cancelled.'));
    this.child.stdin.destroy();
    this.child.kill();
  }

  public async finish(): Promise<void> {
    if (!this.finished) {
      this.ending = true;
      this.child.stdin.end();
      const timer = setTimeout(() => {
        this.fail('Ignore process did not finish.');
      }, QUERY_TIMEOUT_MS);
      await this.closed;
      clearTimeout(timer);
      this.dispose();
    }
    this.signal?.throwIfAborted();
    if (this.failure) {
      throw this.failure;
    }
  }

  public async ignores(directory: string): Promise<null | string> {
    this.signal?.throwIfAborted();
    if (this.failure) {
      throw this.failure;
    }
    const relative = path.relative(this.root, directory).split(path.sep).join('/');
    if (!relative || this.prefixes.has(this.key(relative))) {
      return null;
    }
    if (this.pending || this.finished) {
      throw new GitFilteringError(this.root, 'Ignore query process is unavailable.');
    }
    return new Promise<null | string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail('Ignore query timed out.');
      }, QUERY_TIMEOUT_MS);
      this.pending = {
        reject: (error): void => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (reason): void => {
          clearTimeout(timer);
          resolve(reason);
        },
        target: relative
      };
      // A single outstanding path bounds buffered input; wait for its response before writing another.
      this.child.stdin.write(`${relative}\0`);
    });
  }

  private readonly abort = (): void => {
    this.dispose();
  };

  private fail(reason: string): void {
    if (this.finished) {
      return;
    }
    this.failure = new GitFilteringError(this.root, reason);
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(this.failure);
    this.dispose();
  }

  private key(value: string): string {
    return process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const fields = this.buffer.split('\0');
    if (fields.length <= RECORD_FIELDS) {
      return;
    }
    const [source, line, pattern, target] = fields;
    this.buffer = fields.slice(RECORD_FIELDS).join('\0');
    const pending = this.pending;
    if (!pending || target !== pending.target || this.buffer) {
      this.fail('Malformed ignore response.');
      return;
    }
    this.pending = undefined;
    pending.resolve(source && pattern && !pattern.startsWith('!') ? `Git rule ${source}:${line ?? ''}: ${pattern}` : null);
  }
}

export class GitRepositoryValidationError extends GitFilteringError {
  public constructor(root: string, command: GitCommandFailure) {
    super(root, command.diagnostic, command);
  }
}

export class GitStatusIgnore {
  private readonly repositories = new Map<string, GitIgnoreRepository>();
  public constructor(private readonly signal?: AbortSignal) {}

  public async context(directory: string, parent: GitIgnoreRepository | null): Promise<GitIgnoreRepository | null> {
    if (parent?.root === directory) {
      return parent;
    }
    return await hasRepository(directory) ? this.repository(directory) : parent;
  }

  public dispose(): void {
    for (const repository of this.repositories.values()) {
      repository.dispose();
    }
  }

  public async finish(): Promise<void> {
    for (const repository of this.repositories.values()) {
      await repository.finish();
    }
  }

  public async initialize(root: string): Promise<GitIgnoreRepository | null> {
    await git(root, ['--version'], 'version', this.signal);
    let current = root;
    for (;;) {
      if (await hasRepository(current)) {
        return this.repository(current);
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }

  private async repository(root: string): Promise<GitIgnoreRepository> {
    const existing = this.repositories.get(root);
    if (existing) {
      return existing;
    }
    // Validate gitfiles and worktrees before starting an interactive query process.
    await git(root, ['rev-parse', '--show-toplevel'], 'repository', this.signal);
    const tracked = await git(root, ['ls-files', '--cached', '-z'], 'index', this.signal);
    const repository = new GitIgnoreRepository(root, tracked.split('\0'), this.signal);
    this.repositories.set(root, repository);
    return repository;
  }
}

async function git(root: string, args: string[], stage: GitCommandFailure['stage'], signal?: AbortSignal): Promise<string> {
  try {
    const result = await run('git', ['-C', root, ...args], {
      env: gitEnvironment(),
      maxBuffer: MAX_GIT_OUTPUT,
      ...(signal ? { signal } : {}),
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true
    });
    if (result.stderr.trim()) {
      throw new GitFilteringError(root, result.stderr.trim(), { code: 0, diagnostic: result.stderr.trim(), killed: false, signal: null, stage });
    }
    return result.stdout;
  } catch (error: unknown) {
    signal?.throwIfAborted();
    if (error instanceof GitFilteringError) {
      throw error;
    }
    const details = error as null | Partial<GitCommandFailure>;
    const command: GitCommandFailure = {
      code: details?.code,
      diagnostic: error instanceof Error ? error.message : String(error),
      killed: details?.killed,
      signal: details?.signal,
      stage
    };
    if (stage !== 'version' && typeof command.code === 'number' && command.code > 0 && !command.killed && !command.signal) {
      throw new GitRepositoryValidationError(root, command);
    }
    throw new GitFilteringError(root, command.diagnostic, command);
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const omitted = new Set(['GIT_COMMON_DIR', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_WORK_TREE']);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !omitted.has(name)));
  environment['GIT_FLUSH'] = '1';
  environment['GIT_OPTIONAL_LOCKS'] = '0';
  return environment;
}

async function hasRepository(directory: string): Promise<boolean> {
  try {
    const info = await lstat(path.join(directory, '.git'));
    return info.isDirectory() || info.isFile();
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (['EACCES', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(code ?? '')) {
      return false;
    }
    throw new GitFilteringError(directory, error instanceof Error ? error.message : String(error));
  }
}
