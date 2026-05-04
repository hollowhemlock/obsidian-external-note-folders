export interface PluginSettings {
  dryRunByDefault: boolean;
  externalRootPath: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  dryRunByDefault: true,
  externalRootPath: ''
};
