import type { App } from 'obsidian';

/** Obsidian's settings navigation is not exposed by the public App typings. */
export function openPluginSettings(app: App, pluginId: string): void {
  const settings = (app as {
    setting?: { open?: () => void; openTabById?: (id: string) => void };
  } & App).setting;
  if (!settings?.open || !settings.openTabById) {
    throw new Error('Open Settings → External Note Folders → Template exclusion patterns, then refresh this report.');
  }
  settings.open();
  settings.openTabById(pluginId);
}
