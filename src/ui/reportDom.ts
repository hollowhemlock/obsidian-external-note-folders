export function installReportMenus(container: HTMLElement, menus: HTMLDetailsElement[]): () => void {
  const doc = container.ownerDocument;
  function close(menu: HTMLDetailsElement): void {
    const focused = menu.contains(doc.activeElement);
    menu.open = false;
    if (focused) {
      menu.querySelector('summary')?.focus();
    }
  }
  function clicked(event: MouseEvent): void {
    for (const menu of menus) {
      if (event.target instanceof Node && !menu.contains(event.target)) {
        close(menu);
      }
    }
  }
  function keyed(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      for (const menu of menus) {
        if (menu.open) {
          close(menu);
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }
  }
  doc.addEventListener('click', clicked);
  container.addEventListener('keydown', keyed);
  return (): void => {
    doc.removeEventListener('click', clicked);
    container.removeEventListener('keydown', keyed);
  };
}

export function reportAction(parent: HTMLElement, label: string, callback: () => Promise<void> | void, onError: (message: string) => void): HTMLButtonElement {
  const button = reportElement(parent, 'button', label);
  button.type = 'button';
  button.addEventListener('click', () => {
    Promise.resolve().then(callback).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : 'Action failed.');
    });
  });
  return button;
}

export function reportDisclosure(parent: HTMLElement, label: string): HTMLDetailsElement {
  const section = reportElement(parent, 'details', '', 'leaf-disclosure');
  reportElement(section, 'summary', label);
  return section;
}

export function reportElement<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const node = parent.ownerDocument.createElement(tag);
  node.textContent = text;
  node.className = cls;
  parent.append(node);
  return node;
}
