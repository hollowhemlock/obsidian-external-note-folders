import path from 'node:path';
import {
  PluginSettingTab,
  Setting
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

const EXAMPLE_WINDOWS_EXTERNAL_ROOT = 'C:\\ExternalNoteFolders';
const TEXT_INPUT_VISIBLE_SIZE = 48;

export class PluginSettingsTab extends PluginSettingTab {
  public constructor(app: Plugin['app'], private readonly plugin: Plugin) {
    super(app, plugin);
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const validationMessageEl = containerEl.createEl('p', {
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('External root')
      .setDesc('Absolute path containing bound external folders and their associated .exf markers.')
      .addText((text) => {
        text
          .setPlaceholder(EXAMPLE_WINDOWS_EXTERNAL_ROOT)
          .setValue(this.plugin.settings.externalRootPath)
          .onChange((value) => {
            this.handleExternalRootChanged(value, validationMessageEl).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : 'Unable to save external root setting.';
              validationMessageEl.setText(message);
            });
          });

        text.inputEl.size = TEXT_INPUT_VISIBLE_SIZE;
      });
  }

  private async handleExternalRootChanged(
    rawValue: string,
    validationMessageEl: HTMLParagraphElement
  ): Promise<void> {
    const trimmedValue = rawValue.trim();
    if (trimmedValue.length > 0 && !path.isAbsolute(trimmedValue)) {
      validationMessageEl.setText('External root must be an absolute path.');
      return;
    }

    validationMessageEl.setText('');
    if (trimmedValue === this.plugin.settings.externalRootPath) {
      return;
    }

    this.plugin.settings.externalRootPath = trimmedValue;
    await this.plugin.saveSettings();
  }
}
