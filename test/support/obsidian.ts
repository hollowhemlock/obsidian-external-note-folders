import type {
  App,
  PluginManifest
} from 'obsidian';

/* eslint-disable @typescript-eslint/no-extraneous-class -- Obsidian runtime constructors are stubbed for headless adapter tests. */
export class ButtonComponent {}
export class Modal {}
export class Notice {}
export class Plugin {
  public constructor(public app: App, public manifest: PluginManifest) {}
}
export class PluginSettingTab {}
export class Setting {}
export class TFile {
  public extension = 'md';
  public path = 'Alpha.md';
}
export function parseYaml(text: string): Record<string, string> {
  return { exnf: text.replace('exnf: ', '').trim() };
}
/* eslint-enable @typescript-eslint/no-extraneous-class -- End of headless Obsidian runtime stubs. */
