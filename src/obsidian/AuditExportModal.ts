import type { App } from 'obsidian';

import { Modal } from 'obsidian';

import { validateAuditDestination } from '../storage/auditPaths.ts';

export class AuditExportModal extends Modal {
  private settled = false;
  public constructor(
    app: App,
    private readonly previous: string,
    private readonly signal: AbortSignal,
    private readonly resolve: (path: null | string) => void
  ) {
    super(app);
  }

  public override onClose(): void {
    this.signal.removeEventListener('abort', this.abort);
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
    this.contentEl.replaceChildren();
  }

  public override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    const title = doc.createElement('h2');
    title.textContent = 'Export audit CSV';
    const label = doc.createElement('label');
    label.textContent = 'Absolute destination directory';
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = this.previous;
    input.className = 'external-note-folders-audit-destination';
    label.append(input);
    const description = doc.createElement('p');
    description.textContent = 'Choose an existing writable directory. A new timestamped report folder will be created inside it.';
    const error = doc.createElement('p');
    error.setAttribute('role', 'alert');
    const form = doc.createElement('form');
    const submit = doc.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Export';
    form.append(label, description, error, submit);
    this.contentEl.append(title, form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit.disabled = true;
      validateAuditDestination(input.value).then((destination) => {
        if (this.signal.aborted || this.settled) {
          return;
        }
        this.settled = true;
        this.resolve(destination);
        this.close();
      }).catch(() => {
        error.textContent = 'Enter an existing, writable absolute directory.';
        submit.disabled = false;
      });
    });
    this.signal.addEventListener('abort', this.abort, { once: true });
    if (this.signal.aborted) {
      this.close();
    } else {
      input.focus();
    }
  }

  private readonly abort = (): void => {
    this.close();
  };
}
