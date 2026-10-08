import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  buildSandboxReloadScript,
  refreshSandboxArtifacts
} from './sandbox-refresh.ts';

async function fixture(): Promise<{ build: string; plugin: string; vault: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'exnf-refresh-'));
  const build = path.join(root, 'build');
  const vault = path.join(root, 'vault');
  const plugin = path.join(vault, '.obsidian', 'plugins', 'external-note-folders');
  await mkdir(build, { recursive: true });
  await mkdir(path.join(plugin, 'journal'), { recursive: true });
  for (const directory of [build, plugin]) {
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ id: 'external-note-folders' }));
    await writeFile(path.join(directory, 'main.js'), directory === build ? 'new bundle' : 'old bundle');
  }
  return { build, plugin, vault };
}

describe('sandbox refresh', () => {
  it('updates only built artifacts and preserves notes, settings, journals, and enabled plugins', async () => {
    const { build, plugin, vault } = await fixture();
    await writeFile(path.join(build, 'styles.css'), 'new styles');
    const preserved = [
      path.join(vault, 'test.md'),
      path.join(vault, '.obsidian', 'community-plugins.json'),
      path.join(plugin, 'data.json'),
      path.join(plugin, 'journal', 'pending.json')
    ];
    for (const file of preserved) {
      await writeFile(file, `keep ${file}`);
    }
    expect(await refreshSandboxArtifacts(build, vault)).toBe('external-note-folders');
    expect(await readFile(path.join(plugin, 'main.js'), 'utf8')).toBe('new bundle');
    expect(await readFile(path.join(plugin, 'styles.css'), 'utf8')).toBe('new styles');
    for (const file of preserved) {
      expect(await readFile(file, 'utf8')).toBe(`keep ${file}`);
    }
  });

  it('does not overwrite installed files if any build artifact is missing', async () => {
    const { build, plugin, vault } = await fixture();
    await expect(refreshSandboxArtifacts(build, vault)).rejects.toThrow();
    expect(await readFile(path.join(plugin, 'main.js'), 'utf8')).toBe('old bundle');
  });

  it('requires an existing installation with the expected plugin identity', async () => {
    const { build, plugin, vault } = await fixture();
    await writeFile(path.join(build, 'styles.css'), 'new styles');
    await writeFile(path.join(plugin, 'manifest.json'), JSON.stringify({ id: 'other-plugin' }));
    await expect(refreshSandboxArtifacts(build, vault)).rejects.toThrow('does not match');
    expect(await readFile(path.join(plugin, 'main.js'), 'utf8')).toBe('old bundle');
  });

  it('reloads only the plugin after verifying the sandbox and idle state', async () => {
    const vault = path.resolve('sandbox');
    const oldPlugin = {};
    const plugins = {
      disablePlugin: vi.fn(),
      enablePlugin: vi.fn(),
      getPlugin: vi.fn().mockReturnValueOnce(oldPlugin).mockReturnValueOnce({})
    };
    const result: unknown = await runInNewContext(buildSandboxReloadScript(vault, 'external-note-folders'), {
      app: { plugins, vault: { adapter: { getBasePath: (): string => vault } } },
      process,
      require: (): typeof path => path
    });
    expect(result).toBe('EXNF_SANDBOX_REFRESHED');
    expect(plugins.disablePlugin).toHaveBeenCalledWith('external-note-folders');
    expect(plugins.enablePlugin).toHaveBeenCalledWith('external-note-folders');
  });

  it.each(['wrong vault', 'busy', 'disabled'])('refuses to reload a %s runtime', async (reason) => {
    const vault = path.resolve('sandbox');
    const plugins = {
      disablePlugin: vi.fn(),
      enablePlugin: vi.fn(),
      getPlugin: (): object | undefined => reason === 'disabled' ? undefined : { isMutationInProgress: reason === 'busy' }
    };
    await expect(runInNewContext(buildSandboxReloadScript(vault, 'external-note-folders'), {
      app: { plugins, vault: { adapter: { getBasePath: (): string => reason === 'wrong vault' ? path.resolve('personal') : vault } } },
      process,
      require: (): typeof path => path
    }) as Promise<unknown>).rejects.toThrow();
    expect(plugins.disablePlugin).not.toHaveBeenCalled();
  });
});
