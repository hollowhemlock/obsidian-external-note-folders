import type {
  LeafTreeNode,
  TreeResult
} from '../core/leafTree.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import {
  descendantMarkerExplanation,
  evidenceExplanation
} from '../core/folderInspection.ts';
import { TREE_PAGE_SIZE } from '../core/leafTree.ts';
import { ATTENTION_LABELS } from './folderAttention.ts';

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 28;
const WINDOW_ROWS = 60;
const OVERSCAN_ROWS = 5;
const BASE_PADDING = 12;
const LEVEL_INDENT = 18;
export interface TreeNavigation {
  expanded: Set<string>;
  focused: string | undefined;
  limits: Map<null | string, number>;
  normalExpansion: Set<string> | undefined;
  scrollTop: number;
  selection: string | undefined;
}
interface TreeEntry {
  id: string;
  level: number;
  more: boolean;
  parent: null | string;
  position: number;
  size: number;
}
/** A flat, windowed DOM keeps broad searches bounded while preserving the physical hierarchy. */
export function mountLeafTree(
  container: HTMLElement,
  selected: (node: LeafTreeNode | undefined, hidden: boolean, userInitiated: boolean) => void,
  descriptor: (node: LeafTreeNode) => string
): {
  capture: () => TreeNavigation;
  dispose: () => void;
  redraw: () => Promise<void>;
  restore: (navigation: TreeNavigation) => Promise<void>;
  select: (id: string) => Promise<void>;
  update: (result: TreeResult, search: string, reset?: boolean) => Promise<void>;
} {
  const doc = container.ownerDocument;
  const tree = doc.createElement('div');
  tree.className = 'leaf-tree';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'External folders');
  tree.tabIndex = 0;
  const header = doc.createElement('div');
  header.className = 'leaf-tree-columns';
  header.setAttribute('aria-hidden', 'true');
  for (const title of ['Folder', 'Leaves', 'Descriptor', 'Evidence']) {
    const cell = doc.createElement('span');
    cell.textContent = title;
    header.append(cell);
  }
  const space = doc.createElement('div');
  space.className = 'leaf-tree-space';
  tree.append(header, space);
  container.append(tree);
  let result: TreeResult | undefined;
  let expanded = new Set<string>();
  let normalExpansion: Set<string> | undefined;
  const limits = new Map<null | string, number>();
  let selection: string | undefined;
  let focused: string | undefined;
  let entries: TreeEntry[] = [];
  let positions = new Map<string, number>();
  let abort: AbortController | undefined;
  let disposed = false;
  let userSelection = false;
  const elements = new Map<string, HTMLElement>();
  function notify(): void {
    selected(selection ? result?.nodes.get(selection) : undefined, !!selection && !result?.visible.has(selection), userSelection);
    userSelection = false;
  }
  function reveal(id: string): void {
    let node = result?.nodes.get(id);
    while (node) {
      const siblings = result?.children.get(node.parent) ?? [];
      const index = siblings.indexOf(node.id);
      limits.set(node.parent, Math.max(limits.get(node.parent) ?? TREE_PAGE_SIZE, Math.ceil((index + 1) / TREE_PAGE_SIZE) * TREE_PAGE_SIZE));
      if (node.parent === null) {
        break;
      }
      expanded.add(node.parent);
      node = result?.nodes.get(node.parent);
    }
  }
  function glyph(node: LeafTreeNode): string {
    if (node.children.length) {
      return expanded.has(node.id) ? '▾' : '▸';
    }
    return node.kind === 'link' ? '↗' : '•';
  }
  function run(operation: Promise<void>): void {
    operation.catch(() => {
      tree.setAttribute('aria-label', 'External folders — rendering failed; refresh to retry');
    });
  }
  function leafCount(node: LeafTreeNode): string {
    const count = result?.counts.get(node.id) ?? 0;
    return count === node.total ? count.toLocaleString() : `${count.toLocaleString()}/${node.total.toLocaleString()}`;
  }
  function renderCells(item: HTMLElement, node: LeafTreeNode | undefined, level: number): void {
    const rowLabel = doc.createElement('span');
    rowLabel.className = 'leaf-tree-label';
    rowLabel.style.paddingLeft = `${String(BASE_PADDING + (level - 1) * LEVEL_INDENT)}px`;
    rowLabel.textContent = node ? `${glyph(node)} ${node.segments.at(-1) ?? node.relativePath}` : 'Show next 100…';
    item.append(rowLabel);
    if (!node) {
      describeItem(item, node, rowLabel.textContent);
      return;
    }
    if (node.covered) {
      const inherited = doc.createElement('span');
      inherited.className = 'leaf-inherited';
      inherited.textContent = '↑';
      inherited.title = 'Marker in an ancestor folder. Select this folder to inspect the relationship.';
      inherited.setAttribute('aria-label', inherited.title);
      rowLabel.append(inherited);
    }
    const count = doc.createElement('span');
    count.className = 'leaf-tree-count';
    count.textContent = leafCount(node);
    count.title = `${count.textContent} ${count.textContent.includes('/') ? 'matching / known' : 'known'} physical leaves`;
    const status = doc.createElement('span');
    status.className = 'leaf-tree-descriptor';
    const hidden = node.children.length > 0 && !result?.children.get(node.id)?.length ? ' · children hidden' : '';
    status.textContent = `${descriptor(node)}${hidden}`;
    status.title = status.textContent;
    const evidence = doc.createElement('span');
    evidence.className = 'leaf-tree-evidence';
    renderEvidence(evidence, node);
    item.append(count, status, evidence);
    describeItem(item, node, `${rowLabel.textContent}; ${count.title}; ${status.textContent}`);
  }
  function renderWindow(): void {
    if (disposed) {
      return;
    }
    const activeItem = tree.contains(doc.activeElement) ? doc.activeElement : null;
    let previous: HTMLElement | null = null;
    const start = Math.max(0, Math.floor(tree.scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(entries.length, start + WINDOW_ROWS);
    const used = new Set<string>();
    for (let index = start; index < end; index++) {
      const entry = entries[index];
      if (!entry) {
        continue;
      }
      used.add(entry.id);
      let item = elements.get(entry.id);
      if (!item) {
        item = doc.createElement('div');
        item.className = 'leaf-tree-item';
        item.dataset['treeKey'] = entry.id;
        elements.set(entry.id, item);
      }
      placeItem(item, previous);
      previous = item;
      item.style.top = `${String(index * ROW_HEIGHT)}px`;
      item.tabIndex = entry.id === focused ? 0 : -1;
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(entry.level));
      item.setAttribute('aria-posinset', String(entry.position));
      item.setAttribute('aria-setsize', String(entry.size));
      item.setAttribute('aria-selected', String(entry.id === selection));
      const node = result?.nodes.get(entry.id);
      item.replaceChildren();
      renderCells(item, node, entry.level);
      if (node?.children.length) {
        item.setAttribute('aria-expanded', String(expanded.has(entry.id)));
      } else {
        item.removeAttribute('aria-expanded');
      }
    }
    for (const [id, item] of elements) {
      if (!used.has(id)) {
        item.remove();
        elements.delete(id);
      }
    }
    preserveWindowFocus(activeItem);
  }
  function describeItem(item: HTMLElement, node: LeafTreeNode | undefined, text: string): void {
    const attention = result?.availability.get(node?.id ?? '')?.attention ?? 'neutral';
    item.title = node
      ? `${node.relativePath} — ${node.evidence?.status ?? ''}\n${ATTENTION_LABELS[attention]}\n${descendantMarkerExplanation(node)}`.trimEnd()
      : 'Show more siblings';
    item.dataset['tone'] = attention;
    item.dataset['marked'] = String(!!node?.markers.length);
    const evidenceText = node?.evidence ? `; exact ${node.evidence.exact}; yaml ${node.evidence.yaml}; marker ${node.evidence.marker}` : '';
    item.setAttribute('aria-label', `${text}; ${ATTENTION_LABELS[attention]}${evidenceText}`);
  }
  function renderEvidence(item: HTMLElement, node: LeafTreeNode | undefined): void {
    if (node?.evidence) {
      for (const tag of ['exact', 'yaml', 'marker'] as const) {
        const badge = doc.createElement('span');
        const state = node.evidence[tag];
        badge.className = `leaf-evidence leaf-evidence-${state}`;
        const symbols = { absent: '–', invalid: '⚠', present: '✓', unchecked: '?' };
        badge.textContent = `${tag} ${symbols[state]}`;
        badge.title = evidenceExplanation(node, tag);
        badge.setAttribute('aria-label', `${tag}: ${badge.title}`);
        item.append(badge);
      }
    }
  }
  function placeItem(item: HTMLElement, previous: HTMLElement | null): void {
    const next = previous ? previous.nextSibling : space.firstChild;
    if (next !== item) {
      space.insertBefore(item, next);
    }
  }
  function preserveWindowFocus(activeItem: Element | null): void {
    if (activeItem && doc.activeElement !== activeItem) {
      // Moving a keyed row can blur it; removing an offscreen row must not lose tree keyboard navigation.
      const target = activeItem.isConnected ? activeItem as HTMLElement : tree;
      target.focus({ preventScroll: true });
    }
  }
  function* flatten(): Generator<void, {
    entries: TreeEntry[];
    positions: Map<string, number>;
  }> {
    const next: TreeEntry[] = [];
    const indexes = new Map<string, number>();
    const stack: {
      index: number;
      level: number;
      parent: null | string;
    }[] = [{ index: 0, level: 1, parent: null }];
    while (stack.length) {
      const frame = stack.at(-1);
      if (!frame) {
        break;
      }
      const children = result?.children.get(frame.parent) ?? [];
      const limit = limits.get(frame.parent) ?? TREE_PAGE_SIZE;
      const id = children[frame.index];
      if (id === undefined || frame.index >= limit) {
        if (children.length > limit) {
          const key = `more:${frame.parent ?? ''}`;
          indexes.set(key, next.length);
          next.push({ id: key, level: frame.level, more: true, parent: frame.parent, position: limit + 1, size: children.length });
        }
        stack.pop();
      } else {
        frame.index++;
        indexes.set(id, next.length);
        next.push({ id, level: frame.level, more: false, parent: frame.parent, position: frame.index, size: children.length });
        if (expanded.has(id)) {
          stack.push({ index: 0, level: frame.level + 1, parent: id });
        }
      }
      yield;
    }
    return { entries: next, positions: indexes };
  }
  function getAnchor(hadFocus: boolean): string | undefined {
    return hadFocus ? focused : entries[Math.floor(tree.scrollTop / ROW_HEIGHT)]?.id;
  }
  async function redraw(preserveAnchor = true): Promise<void> {
    abort?.abort();
    const current = new AbortController();
    abort = current;
    const hadFocus = tree.contains(doc.activeElement) && doc.activeElement !== tree;
    const anchor = preserveAnchor ? getAnchor(hadFocus) : undefined;
    const offset = hadFocus ? 0 : tree.scrollTop % ROW_HEIGHT;
    if (anchor && result?.visible.has(anchor)) {
      reveal(anchor);
    }
    try {
      const next = await runAuditSteps(flatten(), { signal: current.signal });
      if (current.signal.aborted || disposed) {
        return;
      }
      entries = next.entries;
      positions = next.positions;
      space.style.height = `${String(entries.length * ROW_HEIGHT)}px`;
      if (anchor && positions.has(anchor)) {
        // eslint-disable-next-line require-atomic-updates -- The current render owns this anchor after its revision check.
        tree.scrollTop = (positions.get(anchor) ?? 0) * ROW_HEIGHT + offset;
      }
      renderWindow();
      if (hadFocus) {
        restoreFocus();
      }
      notify();
    } catch (error: unknown) {
      if (!current.signal.aborted) {
        throw error;
      }
    }
  }
  function restoreFocus(): void {
    while (focused && !positions.has(focused)) {
      focused = result?.nodes.get(focused)?.parent ?? undefined;
    }
    if (focused && positions.has(focused)) {
      focusIndex(positions.get(focused) ?? 0);
    } else {
      tree.focus();
    }
  }
  function pruneExpansion(set: Set<string>, next: TreeResult): void {
    for (const id of set) {
      if (!next.nodes.has(id)) {
        set.delete(id);
      }
    }
  }
  function focusIndex(index: number): void {
    const entry = entries[index];
    if (!entry) {
      tree.focus();
      return;
    }
    focused = entry.id;
    const top = index * ROW_HEIGHT;
    if (top < tree.scrollTop || top + ROW_HEIGHT + HEADER_HEIGHT > tree.scrollTop + tree.clientHeight) {
      tree.scrollTop = top;
    }
    renderWindow();
    elements.get(entry.id)?.focus({ preventScroll: true });
  }
  async function activate(entry: TreeEntry, toggle: boolean): Promise<void> {
    if (entry.more) {
      const limit = limits.get(entry.parent) ?? TREE_PAGE_SIZE;
      focused = result?.children.get(entry.parent)?.[limit];
      limits.set(entry.parent, limit + TREE_PAGE_SIZE);
    } else {
      userSelection = true;
      selection = entry.id;
      focused = entry.id;
      if (toggle && result?.nodes.get(entry.id)?.children.length) {
        if (expanded.has(entry.id)) {
          expanded.delete(entry.id);
        } else {
          expanded.add(entry.id);
        }
      }
    }
    await redraw();
  }
  function clicked(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-key]');
    const entry = entries[positions.get(target?.dataset['treeKey'] ?? '') ?? -1];
    if (entry) {
      target?.focus({ preventScroll: true });
      run(activate(entry, true));
    }
  }
  function moveRight(entry: TreeEntry, index: number): void {
    if (entry.more) {
      run(activate(entry, true));
    } else if (result?.nodes.get(entry.id)?.children.length) {
      if (expanded.has(entry.id)) {
        focusIndex(Math.min(entries.length - 1, index + 1));
      } else {
        run(activate(entry, true));
      }
    }
  }
  function keyed(event: KeyboardEvent): void {
    const index = positions.get(focused ?? '') ?? -1;
    const entry = entries[index];
    if (![' ', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Enter', 'Home'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (event.key === 'ArrowDown') {
      focusIndex(Math.min(entries.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      focusIndex(Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      focusIndex(0);
    } else if (event.key === 'End') {
      focusIndex(entries.length - 1);
    } else if (entry && (event.key === 'Enter' || event.key === ' ')) {
      run(activate(entry, false));
    } else if (entry && event.key === 'ArrowRight') {
      moveRight(entry, index);
    } else if (entry && event.key === 'ArrowLeft') {
      if (expanded.has(entry.id)) {
        expanded.delete(entry.id);
        run(redraw());
      } else if (entry.parent !== null) {
        focusIndex(positions.get(entry.parent) ?? index);
      }
    }
  }
  tree.addEventListener('scroll', renderWindow);
  tree.addEventListener('click', clicked);
  tree.addEventListener('keydown', keyed);
  return {
    capture(): TreeNavigation {
      return {
        expanded: new Set(expanded),
        focused,
        limits: new Map(limits),
        normalExpansion: normalExpansion ? new Set(normalExpansion) : undefined,
        scrollTop: tree.scrollTop,
        selection
      };
    },
    dispose(): void {
      disposed = true;
      abort?.abort();
      tree.removeEventListener('scroll', renderWindow);
      tree.removeEventListener('click', clicked);
      tree.removeEventListener('keydown', keyed);
      tree.remove();
    },
    redraw,
    async restore(navigation): Promise<void> {
      expanded = new Set(navigation.expanded);
      normalExpansion = navigation.normalExpansion ? new Set(navigation.normalExpansion) : undefined;
      focused = navigation.focused;
      selection = navigation.selection;
      limits.clear();
      for (const [key, value] of navigation.limits) {
        limits.set(key, value);
      }
      await redraw(false);
      tree.scrollTop = navigation.scrollTop;
      renderWindow();
      const position = focused ? positions.get(focused) : undefined;
      if (
        position !== undefined && position * ROW_HEIGHT >= tree.scrollTop && (position + 1) * ROW_HEIGHT + HEADER_HEIGHT <= tree.scrollTop + tree.clientHeight
      ) {
        restoreFocus();
      } else {
        tree.focus({ preventScroll: true });
      }
    },
    async select(id): Promise<void> {
      if (!result?.nodes.has(id)) {
        return;
      }
      selection = id;
      focused = id;
      reveal(id);
      await redraw(false);
      restoreFocus();
    },
    async update(next, search, reset = false): Promise<void> {
      const previous = result;
      const restoreExpansion = !search.trim() && normalExpansion !== undefined;
      result = next;
      if (reset) {
        expanded.clear();
        normalExpansion = undefined;
        selection = undefined;
        focused = undefined;
        limits.clear();
        tree.scrollTop = 0;
        entries = [];
      }
      pruneExpansion(expanded, next);
      if (selection && !next.nodes.has(selection)) {
        selection = undefined;
      }
      while (focused && !next.visible.has(focused)) {
        focused = (next.nodes.get(focused) ?? previous?.nodes.get(focused))?.parent ?? undefined;
      }
      if (!focused && tree.contains(doc.activeElement)) {
        tree.focus();
      }
      if (search.trim()) {
        normalExpansion ??= new Set(expanded);
        expanded = new Set(next.visible);
      } else if (normalExpansion) {
        pruneExpansion(normalExpansion, next);
        expanded = normalExpansion;
        normalExpansion = undefined;
      }
      await redraw(!restoreExpansion);
    }
  };
}
