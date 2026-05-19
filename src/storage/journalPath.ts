import path from 'node:path';

export function buildAdoptionJournalRootPath(input: {
  configDir: string;
  pluginId: string;
  vaultRootPath: string;
}): string {
  return path.join(buildJournalRootPath(input), 'adoption');
}

export function buildJournalRootPath(input: {
  configDir: string;
  pluginId: string;
  vaultRootPath: string;
}): string {
  return path.join(input.vaultRootPath, input.configDir, 'plugins', input.pluginId, 'journal');
}

export function buildMarkerMigrationJournalRootPath(input: {
  configDir: string;
  pluginId: string;
  vaultRootPath: string;
}): string {
  return path.join(buildJournalRootPath(input), 'marker-migration');
}
