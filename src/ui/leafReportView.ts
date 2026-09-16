import type {
  LeafGroup,
  LeafQuery,
  LeafQueryResult,
  LeafReportModel,
  LeafRow
} from '../core/leafQuery.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import {
  DEFAULT_LEAF_QUERY,
  GROUP_PAGE_SIZE,
  LEAF_PAGE_SIZE,
  maximumGroupDepth,
  queryLeafSteps
} from '../core/leafQuery.ts';
import { LEAF_REPORT_CSS } from './leafStyles.ts';

export const AUDIT_CSV_NAMES = [
  'markdown-files.csv',
  'markdown-with-exnf.csv',
  'external-folders.csv',
  'exnf-files.csv',
  'correctly-adopted.csv',
  'possibly-missing.csv',
  'unmarked-leaf-folders.csv'
];
export interface LeafReportHost {
  adopt?: (folder: string) => Promise<void> | void;
  cancel?: () => void;
  copy: (text: string) => Promise<void>;
  csvBaseUrl?: string;
  exportLeaves: (rows: readonly LeafRow[], filtered: boolean) => Promise<void>;
  exportReport?: (name: string) => Promise<void>;
  openFolder?: (folderPath: string) => Promise<void>;
  openNote?: (notePath: string) => Promise<void>;
  refresh?: () => Promise<void>;
  resume?: () => Promise<void>;
}
export interface LeafReportView {
  adopted: (folder: string, note: null | string) => void;
  dispose: () => void;
  status: (message: string, busy?: boolean) => void;
  update: (model: LeafReportModel, signal?: AbortSignal) => Promise<void>;
}

export function mountLeafReport(container: HTMLElement, host: LeafReportHost): LeafReportView {
  const doc = container.ownerDocument;
  const root = doc.createElement('section');
  root.className = 'exnf-leaf-report';
  const style = doc.createElement('style');
  style.textContent = LEAF_REPORT_CSS;
  root.append(style);
  container.append(root);
  let model: LeafReportModel | undefined;
  let result: LeafQueryResult | undefined;
  const query: LeafQuery = { ...DEFAULT_LEAF_QUERY };
  let queryAbort: AbortController | undefined;
  let groupPage = 0;
  let leafPage = 0;
  let expanded = '';
  let disposed = false;
  let busy = false;
  const adoptions = new Map<string, null | string>();

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, parent: HTMLElement, cls = ''): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    node.textContent = text;
    node.className = cls;
    parent.append(node);
    return node;
  }
  function action(label: string, parent: HTMLElement, callback: () => Promise<void> | void): HTMLButtonElement {
    const button = element('button', label, parent);
    button.type = 'button';
    button.addEventListener('click', () => {
      Promise.resolve().then(callback).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'Action failed.');
      });
    });
    return button;
  }

  element('h1', 'Unmarked leaf folders', root);
  element('p', 'Leaf folders with no marker in the folder or any ancestor through the external root.', root);
  element('p', 'Full physical audit — ignore patterns not applied', root, 'leaf-context');
  const context = element('div', '', root, 'leaf-context');
  const warning = element('div', '', root, 'leaf-warning');
  const toolbar = element('div', '', root, 'leaf-toolbar');
  const search = element('input', '', toolbar);
  search.type = 'search';
  search.placeholder = 'Search folder or matching note…';
  search.setAttribute('aria-label', 'Search folders and notes');
  const category = element('select', '', toolbar);
  category.setAttribute('aria-label', 'Folder category');
  for (
    const [value, label] of [['all', 'All categories'], ['ordinary', 'Ordinary paths'], ['git', 'Git internals'], ['dependencies', 'Dependencies'], [
      'generated',
      'Likely build / cache'
    ]]
  ) {
    const option = element('option', label ?? '', category);
    option.value = value ?? '';
  }
  element('span', 'Group depth', toolbar);
  const depth = element('input', '', toolbar);
  depth.type = 'number';
  depth.min = '1';
  depth.step = '1';
  depth.setAttribute('aria-label', 'Grouping depth');
  depth.value = '2';
  const slider = element('input', '', toolbar);
  slider.type = 'range';
  slider.min = '1';
  slider.step = '1';
  slider.value = '2';
  slider.setAttribute('aria-label', 'Grouping depth slider');
  if (host.resume) {
    action('Resume folder adoption…', toolbar, host.resume);
  }
  const showAll = action('Show all paths', toolbar, async () => {
    query.showGenerated = !query.showGenerated;
    await refilter();
  });
  const refresh = host.refresh ? action('Refresh', toolbar, host.refresh) : undefined;
  const cancel = host.cancel ? action('Cancel', toolbar, host.cancel) : undefined;
  if (cancel) {
    cancel.hidden = true;
  }
  const stats = element('p', 'No scan yet.', root, 'leaf-stats');
  const status = element('div', '', root, 'leaf-status');
  status.setAttribute('role', 'status');
  const exports = element('div', '', root, 'leaf-toolbar');
  const exportFiltered = action('Export filtered leaves', exports, async () => {
    if (result) {
      await host.exportLeaves(result.rows, true);
    }
  });
  const exportAll = action('Export all leaves', exports, async () => {
    if (model) {
      await host.exportLeaves(model.rows, false);
    }
  });
  const reportSelect = element('select', '', exports);
  reportSelect.setAttribute('aria-label', 'Audit CSV report');
  for (const name of AUDIT_CSV_NAMES) {
    const option = element('option', name, reportSelect);
    option.value = name;
  }
  const exportReport = host.exportReport ? action('Export selected report', exports, () => host.exportReport?.(reportSelect.value)) : undefined;
  if (host.csvBaseUrl !== undefined) {
    const link = element('a', 'Open selected CSV', exports);
    function updateLink(): void {
      link.href = `${host.csvBaseUrl ?? ''}${reportSelect.value}`;
      link.download = reportSelect.value;
    }
    updateLink();
    reportSelect.addEventListener('change', updateLink);
  }
  const pagination = element('div', '', root, 'leaf-pagination');
  const groups = element('div', '', root, 'leaf-groups');
  element(
    'p',
    'Generated-path filters only change this view. Unmarked does not mean adoption is required.',
    root,
    'leaf-context'
  );

  function setStatus(message: string, running = busy): void {
    if (disposed) {
      return;
    }
    busy = running;
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-adoption-blocked]')) {
      button.disabled = busy || button.dataset['adoptionBlocked'] === 'true';
    }
    status.textContent = message;
    if (refresh) {
      refresh.disabled = busy;
    }
    if (cancel) {
      cancel.hidden = !busy;
    }
    exportFiltered.disabled = busy || !result;
    exportAll.disabled = busy || !model;
    if (exportReport) {
      exportReport.disabled = busy || !model;
    }
  }
  function pages(parent: HTMLElement, page: number, size: number, total: number, change: (value: number) => void): void {
    const count = Math.max(1, Math.ceil(total / size));
    action('Previous', parent, () => {
      change(page - 1);
    }).disabled = page === 0;
    element('span', `Page ${String(page + 1)} of ${String(count)}`, parent);
    action('Next', parent, () => {
      change(page + 1);
    }).disabled = page + 1 >= count;
  }
  function identityLabel(identityStatus: string): string {
    const labels: Record<string, string> = {
      'duplicate-uuid': 'Duplicate note UUID',
      'invalid-property': 'Invalid exnf property',
      'missing-property': 'No exnf property',
      'unchecked-frontmatter': 'Frontmatter unchecked',
      'valid': 'Valid exnf UUID'
    };
    return labels[identityStatus] ?? identityStatus;
  }
  function renderRow(row: LeafRow, parent: HTMLElement): void {
    const details = element('details', '', parent, 'leaf-row');
    element('summary', row.relativePath, details);
    element(
      'div',
      row.categories.length
        ? row.categories.map((categoryName) =>
          ({ dependencies: 'Dependencies', generated: 'Likely build / cache / environment', git: 'Git internals' })[categoryName]
        ).join(' · ')
        : 'Ordinary path',
      details,
      'leaf-tags'
    );
    element('p', row.folderPath, details, 'leaf-context');
    const actions = element('div', '', details, 'leaf-toolbar');
    action('Copy path', actions, () => host.copy(row.folderPath));
    if (host.openFolder) {
      action('Open folder', actions, () => host.openFolder?.(row.folderPath));
    }
    if (row.notes.length > 1) {
      element('p', 'Multiple notes derive this folder. This is not proof of a binding.', details);
    }
    for (const note of row.notes) {
      const match = element('div', `${note.notePath} — ${identityLabel(note.status)}`, details, 'leaf-note');
      if (host.openNote) {
        action('Open note', match, () => host.openNote?.(note.notePath));
      }
      action('Copy note path', match, () => host.copy(note.absolutePath));
    }
    if (row.notes.length === 0) {
      element('p', 'No exact note path match.', details, 'leaf-context');
    }
  }
  function renderGroups(): void {
    if (!result || disposed) {
      return;
    }
    const focusedKey = doc.activeElement?.getAttribute('data-group-key') ?? undefined;
    groups.replaceChildren();
    pagination.replaceChildren();
    pages(pagination, groupPage, GROUP_PAGE_SIZE, result.groups.length, (value) => {
      groupPage = value;
      expanded = '';
      renderGroups();
    });
    const visible = result.groups.slice(groupPage * GROUP_PAGE_SIZE, (groupPage + 1) * GROUP_PAGE_SIZE);
    if (visible.length === 0) {
      element('p', 'No matching folders. Try Show all paths or clear your filters.', groups);
    }
    for (const group of visible) {
      renderGroup(group);
    }
    if (focusedKey !== undefined) {
      Array.from(groups.querySelectorAll<HTMLButtonElement>('[data-group-key]')).find((button) => button.dataset['groupKey'] === focusedKey)?.focus();
    }
  }
  function renderGroup(group: LeafGroup): void {
    const section = element('div', '', groups, 'leaf-group');
    const header = element('div', '', section, 'leaf-group-header');
    const toggle = action(`${group.key} · ${group.rows.length.toLocaleString()} ${group.rows.length === 1 ? 'leaf' : 'leaves'}`, header, () => {
      expanded = expanded === group.key ? '' : group.key;
      leafPage = 0;
      renderGroups();
    });
    toggle.className = 'leaf-group-toggle';
    toggle.dataset['groupKey'] = group.key;
    toggle.setAttribute('aria-expanded', String(expanded === group.key));
    if (host.adopt) {
      const affected = [...adoptions].find(([folder]) => {
        const a = folder.replaceAll('\\', '/').toLowerCase();
        const b = group.folderPath.replaceAll('\\', '/').toLowerCase();
        return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
      });
      let label = 'Adopt this folder…';
      if (affected) {
        label = affected[1] ? 'Adopted — refresh to update counts' : 'Pending recovery';
      }
      const button = action(
        label,
        header,
        () => host.adopt?.(group.folderPath)
      );
      button.disabled = busy || !!affected;
      button.dataset['adoptionBlocked'] = String(!!affected);
      if (affected?.[1] && host.openNote) {
        action('Open note', header, () => host.openNote?.(affected[1] ?? ''));
      }
    }
    if (expanded !== group.key) {
      return;
    }
    const rows = element('div', '', section, 'leaf-rows');
    const navigation = element('div', '', rows, 'leaf-pagination');
    pages(navigation, leafPage, LEAF_PAGE_SIZE, group.rows.length, (value) => {
      leafPage = value;
      renderGroups();
    });
    for (const row of group.rows.slice(leafPage * LEAF_PAGE_SIZE, (leafPage + 1) * LEAF_PAGE_SIZE)) {
      renderRow(row, rows);
    }
  }
  async function refilter(): Promise<void> {
    queryAbort?.abort();
    const abort = new AbortController();
    queryAbort = abort;
    if (!model) {
      return;
    }
    exportFiltered.disabled = true;
    const input = model;
    try {
      const filtered = await runAuditSteps(queryLeafSteps(input, { ...query }), { signal: abort.signal });
      if (disposed || abort.signal.aborted) {
        return;
      }
      applyResult(filtered);
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        throw error;
      }
    }
  }
  function applyResult(filtered: LeafQueryResult): void {
    result = filtered;
    groupPage = 0;
    leafPage = 0;
    expanded = '';
    stats.textContent =
      `${filtered.total.toLocaleString()} unmarked leaves · ${filtered.rows.length.toLocaleString()} displayed · ${filtered.hiddenCount.toLocaleString()} generated/internal paths hidden`;
    showAll.textContent = query.showGenerated ? 'Hide generated paths' : 'Show all paths';
    showAll.setAttribute('aria-pressed', String(query.showGenerated));
    renderGroups();
    setStatus(status.textContent, busy);
  }
  function changed(): void {
    refilter().catch(() => {
      setStatus('Filtering failed.');
    });
  }
  search.addEventListener('input', () => {
    query.search = search.value;
    changed();
  });
  category.addEventListener('change', () => {
    query.category = category.value as LeafQuery['category'];
    changed();
  });
  depth.addEventListener('change', () => {
    query.depth = Math.max(1, Math.min(model ? maximumGroupDepth(model) : 1, Math.floor(Number(depth.value)) || 1));
    depth.value = String(query.depth);
    slider.value = depth.value;
    changed();
  });
  slider.addEventListener('input', () => {
    depth.value = slider.value;
    depth.dispatchEvent(new Event('change'));
  });
  setStatus('Ready.', false);
  return {
    adopted(folder, note): void {
      adoptions.set(folder, note);
      if (model) {
        model.stale = true;
      }
      warning.hidden = false;
      warning.textContent = 'This snapshot predates mutations. Refresh to update results and counts. Pending operations can be resumed.';
      renderGroups();
    },
    dispose(): void {
      disposed = true;
      queryAbort?.abort();
      root.remove();
    },
    status: setStatus,
    async update(next, signal): Promise<void> {
      if (disposed) {
        return;
      }
      let filtered: LeafQueryResult;
      const maximum = maximumGroupDepth(next);
      query.depth = Math.min(query.depth, maximum);
      depth.max = String(maximum);
      slider.max = depth.max;
      depth.value = String(query.depth);
      slider.value = depth.value;
      let captured: string;
      do {
        captured = JSON.stringify(query);
        filtered = await runAuditSteps(queryLeafSteps(next, { ...query }), signal ? { signal } : {});
      } while (captured !== JSON.stringify(query));
      signal?.throwIfAborted();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose can run while scheduled analysis is awaiting.
      if (disposed) {
        return;
      }
      queryAbort?.abort();
      model = next;
      adoptions.clear();
      context.textContent = `Vault: ${next.vaultRoot}\nExternal root: ${next.externalRoot}\nScanned: ${next.startedAt} – ${next.finishedAt}\nCoverage: ${
        next.uncheckedCount > 0 ? 'incomplete' : 'complete'
      }`;
      warning.textContent = [
        next.stale ? 'This snapshot predates mutations. Refresh to update results and counts.' : '',
        next.mutationWarning ? 'Results may not reflect in-progress mutations.' : '',
        next.uncheckedCount > 0
          ? `${next.uncheckedCount.toLocaleString()} unchecked items. Only locally checked leaf paths are listed; unscanned areas may contain more.`
          : ''
      ].filter(Boolean).join(' ');
      warning.hidden = warning.textContent.length === 0;
      applyResult(filtered);
    }
  };
}
