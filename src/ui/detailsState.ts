interface DetailsState {
  focused?: string;
  open: Map<string, boolean>;
  scroll: number;
  section?: string;
}
export function captureDetails(parent: HTMLElement): DetailsState {
  const active = parent.ownerDocument.activeElement as HTMLElement | null;
  const focused = active && parent.contains(active) ? active.dataset['detailKey'] : undefined;
  const section = active && parent.contains(active) ? active.closest<HTMLElement>('[data-section]')?.dataset['section'] : undefined;
  return {
    ...(focused ? { focused } : {}),
    ...(section ? { section } : {}),
    open: new Map([...parent.querySelectorAll<HTMLDetailsElement>('details[data-section]')].map((item) => [item.dataset['section'] ?? '', item.open])),
    scroll: parent.scrollTop
  };
}
/** Return a one-shot follow-up for asynchronously populated blocker controls. */
export function restoreDetails(parent: HTMLElement, state: DetailsState): () => void {
  for (const item of parent.querySelectorAll<HTMLDetailsElement>('details[data-section]')) {
    item.open = state.open.get(item.dataset['section'] ?? '') ?? true;
  }
  if (state.focused || state.section) {
    const controls = [...parent.querySelectorAll<HTMLElement>('[data-detail-key]:not([disabled])')];
    const target = controls.find((item) => item.dataset['detailKey'] === state.focused)
      ?? controls.find((item) => item.dataset['detailKey'] === `section:${state.section ?? 'header'}`)
      ?? controls.find((item) => item.dataset['detailKey'] === 'section:header');
    target?.focus({ preventScroll: true });
  }
  parent.scrollTop = state.scroll;
  const restoredFocus = parent.ownerDocument.activeElement;
  const restoredScroll = parent.scrollTop;
  return (): void => {
    // Never steal focus or undo scrolling performed while diagnostics were loading.
    if (state.focused && parent.ownerDocument.activeElement === restoredFocus) {
      const control = [...parent.querySelectorAll<HTMLElement>('[data-detail-key]:not([disabled])')]
        .find((item) => item.dataset['detailKey'] === state.focused);
      control?.focus({ preventScroll: true });
    }
    if (parent.scrollTop === restoredScroll) {
      parent.scrollTop = state.scroll;
    }
  };
}
