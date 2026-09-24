import path from 'node:path';
import {
  PluginSettingTab,
  Setting
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

import { normalizeExternalRootIgnorePatterns } from './core/externalRootIgnore.ts';

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
      .setDesc('Absolute path containing bound external folders and their associated <uuid>.exnf markers.')
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

    const ignoreValidationMessageEl = containerEl.createEl('p', {
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('External root ignore patterns')
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- Exact command name.
        'Newline-separated .gitignore-style patterns relative to the external root. Applies to setup, adoption, recovery, and reconcile scans; External folder status has separate settings. Negation patterns are not supported.'
      )
      .addTextArea((textArea) => {
        textArea
          .setPlaceholder('Enter one ignore pattern per line.')
          .setValue(this.plugin.settings.externalRootIgnorePatterns.join('\n'))
          .onChange((value) => {
            this.handleIgnorePatternsChanged(value, ignoreValidationMessageEl).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : 'Unable to save ignore patterns.';
              ignoreValidationMessageEl.setText(message);
            });
          });
      });

    const templateValidation = containerEl.createEl('p', { cls: 'setting-item-description' });
    new Setting(containerEl)
      .setName('Template exclusion patterns')
      .setDesc(
        'One .gitignore-style pattern per line, relative to the vault root. Matching files cannot own external-folder bindings and are excluded from all note identity checks. Leave empty to include every note. Changes apply on refresh; negation is not supported.'
      )
      .addTextArea((text) => {
        text.setPlaceholder('*.tpl.md\n/settings/templates/\n/settings/templates.archive/')
          .setValue((this.plugin.settings.templateExcludePatterns ?? []).join('\n'))
          .onChange(async (value) => {
            const patterns = value.split(/\r?\n/u).map((pattern) => pattern.trim().replaceAll('\\', '/')).filter(Boolean);
            const validation = normalizeExternalRootIgnorePatterns(patterns, 'vault root');
            templateValidation.setText(validation.errors.map((error) => `${error.pattern}: ${error.message}`).join('; '));
            this.plugin.settings.templateExcludePatterns = patterns;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName('External folder status — this command only').setHeading();
    const statusValidation = containerEl.createEl('p');
    new Setting(containerEl).setName('Ignored folder patterns')
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- Exact command name.
      .setDesc('Only for External folder status. Directory patterns match at any depth; one per line. Does not affect other commands.')
      .addTextArea((text) =>
        text.setValue((this.plugin.settings.statusIgnorePatterns ?? []).join('\n')).onChange(async (value) => {
          const patterns = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
          const validation = normalizeExternalRootIgnorePatterns(patterns);
          statusValidation.setText(validation.errors.map((error) => error.message).join('; '));
          this.plugin.settings.statusIgnorePatterns = patterns;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl).setName('Skip scanning ignored folders')
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- Exact command name.
        'Skip matching folders to reduce scan time. Turn this off to scan them for .exnf markers that may have ended up there unexpectedly. Applies only to External folder status. Changes apply on refresh.'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.statusSkipIgnored ?? false).onChange(async (value) => {
          this.plugin.settings.statusSkipIgnored = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName('Dry-run reconcile by default')
      .setDesc('Show a reconcile plan before any external folders can be moved.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.dryRunByDefault)
          .onChange(async (value) => {
            this.plugin.settings.dryRunByDefault = value;
            await this.plugin.saveSettings();
          });
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

  private async handleIgnorePatternsChanged(
    rawValue: string,
    validationMessageEl: HTMLParagraphElement
  ): Promise<void> {
    const storedPatterns = rawValue
      .split(/\r?\n/u)
      .map((pattern) => pattern.trim().replaceAll('\\', '/'))
      .filter((pattern) => pattern.length > 0);
    const normalizedPatterns = normalizeExternalRootIgnorePatterns(storedPatterns);
    validationMessageEl.setText(
      normalizedPatterns.errors.length === 0
        ? ''
        : normalizedPatterns.errors
          .map((error) => `${error.pattern}: ${error.message}`)
          .join('; ')
    );

    this.plugin.settings.externalRootIgnorePatterns = storedPatterns;
    await this.plugin.saveSettings();
  }
}
