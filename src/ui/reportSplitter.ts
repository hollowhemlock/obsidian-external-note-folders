const MIN_PANE = 320;
const DEFAULT_RATIO = 0.6;
const STEP = 20;
const DIVIDER_SPACE = 24;
export function clampSplit(width: number, ratio: number): number {
  return Math.max(MIN_PANE, Math.min(width - MIN_PANE, width * ratio));
}

export function installReportSplitter(layout: HTMLElement, tree: HTMLElement, details: HTMLElement): () => void {
  const doc = layout.ownerDocument;
  const splitter = doc.createElement('div');
  splitter.className = 'leaf-splitter';
  splitter.tabIndex = 0;
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-label', 'Resize folder tree and details');
  splitter.setAttribute('aria-orientation', 'vertical');
  const reset = doc.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset pane width';
  reset.className = 'leaf-reset-split';
  details.before(splitter);
  layout.after(reset);
  let ratio = DEFAULT_RATIO;
  let pointer: number | undefined;
  let frame: number | undefined;
  const view = doc.defaultView;
  if (!view) {
    throw new Error('Report window is unavailable.');
  }
  const win: Window = view;
  function width(): number {
    return layout.clientWidth - DIVIDER_SPACE;
  }
  function render(): void {
    frame = undefined;
    const available = width();
    const pixels = clampSplit(available, ratio);
    layout.style.setProperty('--leaf-tree-width', `${String(pixels)}px`);
    splitter.setAttribute('aria-valuemin', String(MIN_PANE));
    splitter.setAttribute('aria-valuemax', String(Math.max(MIN_PANE, available - MIN_PANE)));
    splitter.setAttribute('aria-valuenow', String(Math.round(pixels)));
    splitter.setAttribute('aria-valuetext', `Tree ${String(Math.round(pixels))} pixels; details ${String(Math.round(available - pixels))} pixels`);
  }
  function schedule(): void {
    frame ??= win.requestAnimationFrame(render);
  }
  function flush(): void {
    if (frame !== undefined) {
      win.cancelAnimationFrame(frame);
    }
    render();
  }
  function setPixels(pixels: number, immediate = false): void {
    const available = width();
    ratio = clampSplit(available, pixels / available) / available;
    if (immediate) {
      flush();
    } else {
      schedule();
    }
  }
  function down(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    pointer = event.pointerId;
    splitter.setPointerCapture(pointer);
    splitter.focus();
    event.preventDefault();
  }
  function move(event: PointerEvent): void {
    if (event.pointerId === pointer) {
      setPixels(event.clientX - layout.getBoundingClientRect().left);
    }
  }
  function up(): void {
    pointer = undefined;
  }
  function keyed(event: KeyboardEvent): void {
    const current = tree.getBoundingClientRect().width;
    const values: Record<string, number> = { ArrowLeft: current - STEP, ArrowRight: current + STEP, End: width() - MIN_PANE, Home: MIN_PANE };
    const value = values[event.key];
    if (value !== undefined) {
      event.preventDefault();
      setPixels(value, true);
    }
  }
  function resetSplit(): void {
    ratio = DEFAULT_RATIO;
    flush();
  }
  splitter.addEventListener('pointerdown', down);
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
  splitter.addEventListener('pointercancel', up);
  splitter.addEventListener('lostpointercapture', up);
  splitter.addEventListener('keydown', keyed);
  reset.addEventListener('click', resetSplit);
  const observer = new ResizeObserver(schedule);
  observer.observe(layout);
  render();
  return (): void => {
    observer.disconnect();
    if (frame !== undefined) {
      win.cancelAnimationFrame(frame);
    }
    splitter.removeEventListener('pointerdown', down);
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
    splitter.removeEventListener('pointercancel', up);
    splitter.removeEventListener('lostpointercapture', up);
    splitter.removeEventListener('keydown', keyed);
    reset.removeEventListener('click', resetSplit);
    splitter.remove();
    reset.remove();
  };
}
