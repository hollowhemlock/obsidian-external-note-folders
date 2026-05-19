import { Modal } from 'obsidian';

export class CommandProgressModal extends Modal {
  public constructor(
    app: Modal['app'],
    private readonly title: string,
    private readonly description: string
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('external-note-folders-progress-modal');

    contentEl.createEl('h2', { text: this.title });
    contentEl.createEl('p', { text: this.description });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'This may take a bit for broad external roots. This window will close when the next report, plan, or result is ready.'
    });
  }
}
