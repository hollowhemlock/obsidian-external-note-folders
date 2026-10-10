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
    private readonly reportContext: ReportContext,
    private readonly resuming = false
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
    if (this.plan.inspectionPolicy) {
      contentEl.createEl('p', { text: `UUID: ${this.plan.uuid ?? ''}\nMarker: ${this.plan.targetPath}/${this.plan.uuid ?? ''}.exnf` });
      if (this.resuming) {
        contentEl.createEl('p', { text: 'Continue the same pending operation. Its UUID, target, and completed writes remain unchanged.' });
      }
      const exclusions = contentEl.createEl('details');
      exclusions.createEl('summary', { text: 'Excluded from checks' });
      exclusions.createEl('p', { text: 'Excluded locations may contain undiscovered markers.' });
      exclusions.createEl('pre', {
        text: this.plan.inspectionPolicy.omissions.map((item) => `${item.location}\n${item.reason}`).join('\n\n') || 'No intentional omissions.'
      });
    }

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

    if (this.plan.ignoredDirectoryCount > 0 && !this.plan.inspectionPolicy) {
      contentEl.createEl('p', {
        cls: 'setting-item-description',
        text: `${String(this.plan.ignoredDirectoryCount)} configured ignored director${
          this.plan.ignoredDirectoryCount === 1 ? 'y was' : 'ies were'
        } unchecked and excluded from setup topology.`
      });
    }

    const label = this.plan.action === 'confirm-marker-restore' ? 'Restore identifier and open' : 'Bind folder and open';
    new ButtonComponent(contentEl)
      .setButtonText(this.resuming ? 'Confirm updated checks and resume' : label)
      .setCta()
      .onClick(() => {
        this.close();
        this.onConfirm().catch((error: unknown) => {
          console.error('[external-note-folders] setup confirmation failed', error);
        });
      });
  }
}
