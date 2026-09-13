import { Modal } from 'obsidian';

import type { ModalDetail } from './modalDetails.ts';

import { renderModalDetails } from './modalDetails.ts';

export interface CommandProgressOptions {
  details?: readonly ModalDetail[];
  footerText?: string;
}

export class CommandProgressModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly title: string,
    private readonly description: string,
    private readonly options: CommandProgressOptions = {}
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-progress-modal');

    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: this.description });
    if (this.options.details) {
      renderModalDetails(contentEl, this.options.details);
    }
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.options.footerText
        ?? 'This may take a bit for broad external roots. This window will close when the next report, plan, or result is ready.'
    });
  }
}
