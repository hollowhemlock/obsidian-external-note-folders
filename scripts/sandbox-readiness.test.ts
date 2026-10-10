import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  buildSandboxReadinessScript,
  waitForSandboxReadiness
} from './sandbox-readiness.ts';

describe('sandbox readiness after reload', () => {
  it('waits for the exact sandbox, loaded plugin, and registered commands without writing', () => {
    const vault = path.resolve('sandbox');
    const script = buildSandboxReadinessScript(vault, 'external-note-folders');
    const app = {
      commands: { commands: {} as Record<string, unknown> },
      plugins: { getPlugin: vi.fn(() => undefined as unknown) },
      vault: { adapter: { getBasePath: (): string => vault } }
    };
    const context = { app, process, require: (): typeof path => path };
    expect(runInNewContext(script, context)).toContain('WAITING');
    app.plugins.getPlugin.mockReturnValue({});
    expect(runInNewContext(script, context)).toContain('WAITING');
    app.commands.commands['external-note-folders:setup-external-folder'] = {};
    app.commands.commands['external-note-folders:explore-unmarked-external-leaf-folders'] = {};
    expect(runInNewContext(script, context)).toBe('EXNF_SANDBOX_READY');
    app.vault.adapter.getBasePath = (): string => path.resolve('other');
    expect(runInNewContext(script, context)).toContain('WRONG_VAULT');
  });

  it('bounds retries by one deadline and preserves the final diagnostic', async () => {
    let time = 0;
    const probe = vi.fn((remaining: number) => {
      expect(remaining).toBeGreaterThan(0);
      return { command: 'eval', errorMessage: '', status: 0, stderr: '', stdout: 'EXNF_SANDBOX_WAITING: commands' };
    });
    await expect(waitForSandboxReadiness(probe, {
      delay: async (ms) => {
        time += ms;
      },
      now: () => time,
      timeoutMs: 500
    })).rejects.toThrow('commands');
    expect(time).toBe(500);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('retries startup failures but immediately rejects the wrong vault', async () => {
    const result = { command: 'eval', errorMessage: '', status: 0, stderr: '', stdout: 'EXNF_SANDBOX_READY' };
    const probe = vi.fn().mockReturnValueOnce({ ...result, status: 1, stdout: 'runtime starting' }).mockReturnValue(result);
    await waitForSandboxReadiness(probe, { delay: async () => undefined });
    expect(probe).toHaveBeenCalledTimes(2);
    const wrong = vi.fn(() => ({ ...result, stdout: 'EXNF_SANDBOX_WRONG_VAULT: other' }));
    await expect(waitForSandboxReadiness(wrong)).rejects.toThrow('wrong vault');
    expect(wrong).toHaveBeenCalledTimes(1);
  });
});
