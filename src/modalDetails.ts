export interface ModalDetail {
  label: string;
  value: string;
}

export function renderModalDetails(containerEl: HTMLElement, details: readonly ModalDetail[]): void {
  const listEl = containerEl.createEl('dl', { cls: 'external-note-folders-modal-details' });
  for (const detail of details) {
    listEl.createEl('dt', { text: detail.label });
    listEl.createEl('dd', { text: detail.value });
  }
}
