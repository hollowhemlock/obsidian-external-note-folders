import type { InspectionIndex } from '../core/folderInspection.ts';
import type {
  LeafReportModel,
  LeafRow
} from '../core/leafQuery.ts';
import type {
  LeafTreeNode,
  TreeQuery,
  TreeResult
} from '../core/leafTree.ts';
import type { TreeNavigation } from './leafTreeView.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import {
  createInspectionIndex,
  shortFolderStatus
} from '../core/folderInspection.ts';
import {
  availableTreeStatuses,
  DEFAULT_TREE_QUERY,
  queryTreeSteps,
  retainAvailableTreeStatus
} from '../core/leafTree.ts';
import { revealTreePath } from '../core/leafTreeNavigation.ts';
import { ATTENTION_LABELS } from './folderAttention.ts';
import {
  paged,
  renderFolderDetails
} from './folderDetails.ts';
import { LEAF_REPORT_CSS } from './leafStyles.ts';
import { mountLeafTree } from './leafTreeView.ts';
import {
  installReportMenus,
  reportDisclosure
} from './reportDom.ts';

export const AUDIT_CSV_NAMES = [
  'folder-status.csv',
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
  exportStatus?: (nodes: LeafTreeNode[], filtered: boolean) => Promise<void>;
  openFolder?: (folderPath: string) => Promise<void>;
  openNote?: (notePath: string) => Promise<void>;
  refresh?: () => Promise<void>;
  repair?: (folder: string, direction: 'external' | 'note') => Promise<void>;
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
  let result: TreeResult | undefined;
  const query: TreeQuery = { ...DEFAULT_TREE_QUERY };
  let filterRevision = 0;
  let updateRevision = 0;
  let detailsAbort: AbortController | undefined;
  let queryAbort: AbortController | undefined;
  let disposed = false;
  let busy = false;
  let inspection: InspectionIndex | undefined;
  let jump: { navigation: TreeNavigation; targetId: string } | undefined;
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
  element('h1', 'External folder status', root);
  element('p', 'Folder bindings, note associations, and scan coverage.', root);
  element('p', 'Physical audit — command-specific exclusions are disclosed below', root, 'leaf-context');
  const scanDetails = reportDisclosure(root, 'Scan details');
  const context = element('div', '', scanDetails, 'leaf-context');
  const scanIssues = element('div', '', scanDetails);
  const warning = element('div', '', root, 'leaf-warning');
  const toolbar = element('div', '', root, 'leaf-toolbar');
  const search = element('input', '', toolbar);
  search.type = 'search';
  search.placeholder = 'Search folder or matching note…';
  search.setAttribute('aria-label', 'Search folders and notes');
  const viewMenu = reportDisclosure(toolbar, 'View');
  const viewControls = element('div', '', viewMenu, 'leaf-toolbar');
  const category = element('select', '', viewControls);
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
  const mode = element('select', '', viewControls);
  mode.setAttribute('aria-label', 'Tree view');
  for (const [value, label] of [['all', 'All scanned folders'], ['results', 'Unmarked leaves']]) {
    element('option', label ?? '', mode).value = value ?? '';
  }
  const statusFilter = element('select', '', viewControls);
  statusFilter.setAttribute('aria-label', 'Binding status');
  element('option', 'All statuses', statusFilter).value = '';
  statusFilter.addEventListener('change', () => {
    query.status = statusFilter.value;
    changed();
  });
  const expectedToggle = action('Include expected paths from identified notes', viewControls, async () => {
    query.includeExpected = !query.includeExpected;
    expectedToggle.setAttribute('aria-pressed', String(query.includeExpected));
    jump = undefined;
    await refilter();
  });
  expectedToggle.setAttribute('aria-pressed', 'false');
  const sort = element('select', '', viewControls);
  sort.setAttribute('aria-label', 'Sort siblings');
  for (const [value, label] of [['name', 'Name'], ['count', 'Most leaves']]) {
    element('option', label ?? '', sort).value = value ?? '';
  }
  if (host.resume) {
    action('Resume folder adoption…', viewControls, host.resume);
  }
  const showAll = action('Show all paths', viewControls, async () => {
    query.showGenerated = !query.showGenerated;
    jump = undefined;
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
  const exportMenu = reportDisclosure(toolbar, 'Export');
  const exports = element('div', '', exportMenu, 'leaf-toolbar');
  const disposeMenus = installReportMenus(root, [viewMenu, exportMenu]);
  const activeFilters = element('div', '', root, 'leaf-active-filters');
  const filterText = element('span', '', activeFilters);
  const clearFilters = action('Clear filters', activeFilters, () => {
    Object.assign(query, { ...DEFAULT_TREE_QUERY, includeExpected: false, sort: query.sort, status: '' });
    search.value = '';
    category.value = 'all';
    mode.value = 'all';
    statusFilter.value = '';
    expectedToggle.setAttribute('aria-pressed', 'false');
    changed();
  });
  if (host.exportStatus) {
    action('Export filtered status', exports, async () => {
      if (result) {
        await host.exportStatus?.([...result.nodes.values()].filter((node) => result?.matched.has(node.id) === true), true);
      }
    });
    action('Export all status', exports, async () => {
      if (model) {
        await host.exportStatus?.(model.tree ?? [], false);
      }
    });
  }
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
  const rootLabel = element('h2', '', root);
  rootLabel.tabIndex = -1;
  action('Inspect external root', root, async () => {
    if (model?.rootFolder) {
      await jumpTo(model.rootFolder);
    }
  });
  element(
    'p',
    'exact = matching note path · yaml = valid note exnf · marker = Contains .exnf marker · ↑ = marker above. ✓ found · – absent · ? unchecked · ⚠ invalid. Evidence tags do not by themselves prove a binding.',
    root,
    'leaf-legend'
  );
  const layout = element('div', '', root, 'leaf-layout');
  const attentionLegend = element('p', '', root, 'leaf-legend leaf-attention-legend');
  layout.before(attentionLegend);
  for (const tone of ['neutral', 'healthy', 'optional', 'review', 'conflict'] as const) {
    const label = element('span', ATTENTION_LABELS[tone], attentionLegend, 'leaf-attention');
    label.dataset['tone'] = tone;
  }
  const groups = element('div', '', layout);
  const details = element('aside', '', layout, 'leaf-details');
  details.setAttribute('aria-label', 'Selected folder details');
  const tree = mountLeafTree(groups, selected, badges, (node) => {
    const overlay = affected(node);
    if (!overlay) {
      return undefined;
    }
    return overlay[1] === null ? 'pending' : 'changed';
  });
  element('p', 'Generated-path filters only change this view. Unmarked does not mean adoption is required.', root, 'leaf-context');
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
  function affected(node: LeafTreeNode): [
    string,
    null | string
  ] | undefined {
    return [...adoptions].find(([folder]) => {
      const a = folder.replaceAll('\\', '/').toLowerCase();
      const b = node.folderPath.replaceAll('\\', '/').toLowerCase();
      return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    });
  }
  function badges(node: LeafTreeNode): string {
    const overlay = affected(node);
    if (overlay) {
      return overlay[1] === null ? ' · ⚠ Pending recovery' : ' · ✓ Binding changed this session';
    }
    return ` · ${shortFolderStatus(node)}`;
  }
  function renderDetails(node: LeafTreeNode | undefined, hidden: boolean): void {
    detailsAbort?.abort();
    details.replaceChildren();
    if (!node || !model || !inspection) {
      element('p', 'Select a folder to inspect paths, note matches, and actions.', details);
      return;
    }
    if (jump) {
      element('p', 'Temporarily inspecting a related folder. Filters, counts, and exports are unchanged.', details, 'leaf-context');
      action('Back to selected folder', details, backFromJump);
    } else if (hidden) {
      element('p', 'Selected folder is hidden by the current filters.', details, 'leaf-warning');
    }
    const abort = new AbortController();
    detailsAbort = abort;
    renderFolderDetails(details, node, {
      busy,
      host,
      index: inspection,
      model,
      onError: setStatus,
      overlay: affected(node),
      select: jumpTo,
      signal: abort.signal
    });
  }
  function selected(node: LeafTreeNode | undefined, hidden: boolean, userInitiated: boolean): void {
    if (userInitiated && jump) {
      jump = undefined;
      if (result) {
        tree.update(result, query.search).catch(() => {
          setStatus('Unable to finish navigation.');
        });
      }
    }
    const target = jump?.targetId === inspection?.rootId ? model?.rootFolder : node;
    renderDetails(target, hidden);
  }
  async function jumpTo(node: LeafTreeNode): Promise<void> {
    if (!result) {
      return;
    }
    jump = { navigation: jump?.navigation ?? tree.capture(), targetId: node.id };
    if (node.id === inspection?.rootId) {
      renderDetails(node, false);
      rootLabel.focus();
    } else {
      await tree.update(revealTreePath(result, node.id, query.sort), query.search);
      await tree.select(node.id);
    }
  }
  async function backFromJump(): Promise<void> {
    const previous = jump;
    jump = undefined;
    if (previous && result) {
      await tree.update(result, query.search);
      await tree.restore(previous.navigation);
    }
  }
  async function refilter(): Promise<void> {
    const revision = ++filterRevision;
    root.setAttribute('aria-busy', 'true');
    queryAbort?.abort();
    const abort = new AbortController();
    queryAbort = abort;
    if (!model) {
      return;
    }
    exportFiltered.disabled = true;
    const input = model;
    try {
      const filtered = await runAuditSteps(queryTreeSteps(input, { ...query }), { signal: abort.signal });
      if (disposed || abort.signal.aborted) {
        return;
      }
      await applyResult(filtered);
      if (revision === filterRevision) {
        root.setAttribute('aria-busy', 'false');
      }
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        throw error;
      }
    }
  }
  async function applyResult(filtered: TreeResult, reset = false): Promise<void> {
    result = filtered;
    const nodes = model?.tree ?? [];
    const physical = nodes.filter((node) => node.kind === 'directory').length;
    const leaves = nodes.filter((node) => node.evidence?.physicalLeaf === true).length;
    const displayed = [...filtered.matched].filter((id) => filtered.nodes.get(id)?.kind === 'directory').length;
    const excluded = nodes.filter((node) => node.kind === 'excluded').length;
    const virtual = nodes.filter((node) => node.kind === 'virtual' && filtered.matched.has(node.id)).length;
    stats.textContent = `${String(physical)} physical folders · ${String(leaves)} known physical leaves · ${String(displayed)} displayed folders · ${
      String(excluded)
    } excluded branches · ${String(virtual)} displayed virtual paths`;
    showAll.textContent = query.showGenerated ? 'Hide generated/internal paths' : 'Show all generated/internal paths';
    showAll.setAttribute('aria-pressed', String(query.showGenerated));
    renderActiveFilters();
    await tree.update(jump ? revealTreePath(filtered, jump.targetId, query.sort) : filtered, query.search, reset);
    setStatus(status.textContent, busy);
  }
  function renderActiveFilters(): void {
    const labels = [
      query.search ? `Search: ${query.search}` : '',
      query.category === 'all' ? '' : `Category: ${query.category}`,
      query.mode === 'all' ? '' : 'Unmarked leaves',
      query.status ?? '',
      query.showGenerated ? '' : 'Generated paths hidden',
      query.includeExpected ? 'Expected paths included' : ''
    ].filter(Boolean);
    filterText.textContent = labels.length ? labels.join(' · ') : 'All scanned folders';
    clearFilters.hidden = !labels.length;
  }
  function changed(preserveJump = false): void {
    if (!preserveJump) {
      jump = undefined;
    }
    refilter().catch(() => {
      setStatus('Filtering failed.');
    });
  }
  search.addEventListener('input', () => {
    query.search = search.value;
    changed();
  });
  category.addEventListener('change', () => {
    query.category = category.value as TreeQuery['category'];
    changed();
  });
  mode.addEventListener('change', () => {
    query.mode = mode.value as TreeQuery['mode'];
    changed();
  });
  sort.addEventListener('change', () => {
    query.sort = sort.value as TreeQuery['sort'];
    changed(true);
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
      tree.redraw().catch(() => {
        setStatus('Unable to update tree.');
      });
    },
    dispose(): void {
      disposed = true;
      queryAbort?.abort();
      detailsAbort?.abort();
      disposeMenus();
      tree.dispose();
      root.remove();
    },
    status: setStatus,
    async update(next, signal): Promise<void> {
      if (disposed) {
        return;
      }
      const revision = ++updateRevision;
      const availableStatuses = availableTreeStatuses(next.tree ?? []);
      let filtered: TreeResult;
      let captured: string;
      let nextStatus: string;
      do {
        nextStatus = retainAvailableTreeStatus(query.status, availableStatuses);
        captured = JSON.stringify(query);
        filtered = await runAuditSteps(queryTreeSteps(next, { ...query, status: nextStatus }), signal ? { signal } : {});
      } while (captured !== JSON.stringify(query));
      signal?.throwIfAborted();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose can run while scheduled analysis is awaiting.
      if (disposed || revision !== updateRevision) {
        return;
      }
      filterRevision++;
      root.setAttribute('aria-busy', 'false');
      queryAbort?.abort();
      const reset = !!model && (model.externalRoot !== next.externalRoot || model.vaultRoot !== next.vaultRoot);
      model = next;
      query.status = nextStatus;
      inspection = createInspectionIndex(next);
      jump = undefined;
      statusFilter.replaceChildren();
      element('option', 'All statuses', statusFilter).value = '';
      for (const value of availableStatuses) {
        element('option', value, statusFilter).value = value;
      }
      statusFilter.value = query.status ?? '';
      rootLabel.textContent = next.externalRoot;
      adoptions.clear();
      context.textContent = `Vault: ${next.vaultRoot}\nExternal root: ${next.externalRoot}\nScanned: ${next.startedAt} – ${next.finishedAt}\nCoverage: ${
        next.uncheckedCount > 0 ? 'incomplete' : 'complete'
      }`;
      scanIssues.replaceChildren();
      paged(scanIssues, next.coverage?.issues ?? [], (issue) => {
        element('p', `${issue.scope} · ${issue.kind}\n${issue.location}\n${issue.reason}`, scanIssues, 'leaf-context');
      });
      warning.textContent = [
        next.stale ? 'This snapshot predates mutations. Refresh to update results and counts.' : '',
        next.mutationWarning ? 'Results may not reflect in-progress mutations.' : '',
        next.uncheckedCount > 0
          ? `${next.uncheckedCount.toLocaleString()} unchecked items. Unchecked locations remain visible; unscanned areas may contain additional folders.`
          : ''
      ].filter(Boolean).join(' ');
      warning.hidden = warning.textContent.length === 0;
      await applyResult(filtered, reset);
    }
  };
}
