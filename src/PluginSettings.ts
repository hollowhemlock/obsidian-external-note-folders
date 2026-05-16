export interface PluginSettings {
  dryRunByDefault: boolean;
  externalRootIgnorePatterns: string[];
  externalRootPath: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  dryRunByDefault: true,
  externalRootIgnorePatterns: [],
  externalRootPath: ''
};
