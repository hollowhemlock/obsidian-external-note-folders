import type { ObsidianCliResult } from './obsidian-cli.ts';

import { formatObsidianCliResult } from './obsidian-cli.ts';

interface ReadinessOptions {
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

/** Probe only: never write into whichever vault happens to be active. */
export function buildSandboxReadinessScript(vaultPath: string, pluginId: string): string {
  return `(() => {
    const path = require('node:path');
    const key = value => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const actual = app.vault.adapter.getBasePath();
    if (key(actual) !== key(${JSON.stringify(vaultPath)})) return 'EXNF_SANDBOX_WRONG_VAULT: ' + actual;
    const id = ${JSON.stringify(pluginId)};
    if (!app.plugins.getPlugin(id)) return 'EXNF_SANDBOX_WAITING: plugin';
    const commands = app.commands.commands;
    if (!commands[id + ':setup-external-folder'] || !commands[id + ':explore-unmarked-external-leaf-folders']) {
      return 'EXNF_SANDBOX_WAITING: commands';
    }
    return 'EXNF_SANDBOX_READY';
  })()`;
}

export async function waitForSandboxReadiness(
  probe: (remainingMilliseconds: number) => ObsidianCliResult,
  options: ReadinessOptions = {}
): Promise<void> {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? (async (milliseconds: number): Promise<void> => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  });
  const deadline = now() + (options.timeoutMs ?? 30_000);
  let diagnostic = 'No readiness response.';
  while (now() < deadline) {
    const result = probe(Math.max(1, deadline - now()));
    diagnostic = formatObsidianCliResult(result);
    if (result.stdout.includes('EXNF_SANDBOX_WRONG_VAULT')) {
      throw new Error(`Obsidian is serving the wrong vault. Open the sandbox with npm run vault:open.\n${diagnostic}`);
    }
    if (result.status === 0 && !result.errorMessage && result.stdout.includes('EXNF_SANDBOX_READY')) {
      return;
    }
    const remaining = deadline - now();
    if (remaining > 0) {
      await delay(Math.min(250, remaining));
    }
  }
  throw new Error(`Sandbox plugin did not become ready before the deadline.\n${diagnostic}`);
}
