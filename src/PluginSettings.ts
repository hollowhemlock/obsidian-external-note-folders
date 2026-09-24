export interface PluginSettings {
  dryRunByDefault: boolean;
  externalRootIgnorePatterns: string[];
  externalRootPath: string;
  statusIgnorePatterns?: string[];
  statusSkipIgnored?: boolean;
  templateExcludePatterns?: string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  dryRunByDefault: true,
  externalRootIgnorePatterns: [],
  externalRootPath: '',
  statusIgnorePatterns: ['.git/', 'node_modules/', 'build/', 'dist/', '.cache/', '__pycache__/', '.venv/'],
  statusSkipIgnored: false,
  templateExcludePatterns: []
};
