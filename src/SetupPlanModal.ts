import {
  ButtonComponent,
  Modal
} from 'obsidian';

import type { SetupPlan } from './core/setupPlan.ts';
import type { ReportContext } from './modalReport.ts';

import { renderReportContext } from './modalReport.ts';

export class SetupPlanModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly plan: SetupPlan,
    private readonly onConfirm: () => Promise<void>,
    private readonly reportContext: ReportContext
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-setup-plan-modal');
    contentEl.createEl('h2', { text: 'Set up external folder' });
    renderReportContext(contentEl, this.reportContext);
    contentEl.createEl('p', { text: `Vault file: ${this.plan.notePath}` });
    contentEl.createEl('p', { text: `Expected external folder: ${this.plan.targetPath}` });

    if (this.plan.errors.length > 0) {
      contentEl.createEl('h3', { text: 'Blocked' });
      const list = contentEl.createEl('ul');
      for (const error of this.plan.errors) {
        list.createEl('li', { text: error });
      }
      return;
    }

    if (this.plan.action === 'confirm-marker-restore') {
      contentEl.createEl('p', {
        text: `Restore marker UUID ${this.plan.uuid ?? '-'} into this note after a complete uniqueness scan.`
      });
      if (this.plan.legacyMarkerPaths.length > 0) {
        contentEl.createEl('p', {
          cls: 'setting-item-description',
          text: 'The restored identity includes a legacy .exnf marker. Run the legacy marker migration command after setup.'
        });
      }
    } else {
      contentEl.createEl('p', {
        text: 'Bind this existing exact-path folder to the note. Existing payload files will not be changed.'
      });
    }

    if (this.plan.ignoredDirectoryCount > 0) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: `${String(this.plan.ignoredDirectoryCount)} configured ignored director${
          this.plan.ignoredDirectoryCount === 1 ? 'y was' : 'ies were'
        } unchecked and excluded from setup topology.`
      });
    }

    new ButtonComponent(contentEl)
      .setButtonText(this.plan.action === 'confirm-marker-restore' ? 'Restore identifier and open' : 'Bind folder and open')
      .setCta()
      .onClick(() => {
        this.close();
        this.onConfirm().catch((error: unknown) => {
          console.error('[external-note-folders] setup confirmation failed', error);
        });
      });
  }
}
