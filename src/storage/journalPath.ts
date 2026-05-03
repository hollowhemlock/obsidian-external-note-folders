import path from 'node:path';

export function buildJournalRootPath(input: {
  configDir: string;
  pluginId: string;
  vaultRootPath: string;
}): string {
  return path.join(input.vaultRootPath, input.configDir, 'plugins', input.pluginId, 'journal');
}
