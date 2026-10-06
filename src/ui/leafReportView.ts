import type { InspectionIndex } from '../core/folderInspection.ts';
import type { IssueOrder } from '../core/issueNavigation.ts';
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
import type {
  ScanContext,
  ScanFailure
} from './scanFailure.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import { statusExportNode } from '../core/folderAvailability.ts';
import {
  createInspectionIndex,
  shortFolderStatus
} from '../core/folderInspection.ts';
import {
  adjacentIssue,
  adoptableLeafOrderSteps,
  issueOrderSteps
} from '../core/issueNavigation.ts';
import {
  availableTreeStatuses,
  DEFAULT_TREE_QUERY,
  queryTreeSteps,
  retainAvailableTreeStatus
} from '../core/leafTree.ts';
import { revealTreePath } from '../core/leafTreeNavigation.ts';
import {
  coverageNotice,
  scanProblemSummary
} from '../core/scanCoveragePresentation.ts';
import {
  captureDetails,
  restoreDetails
} from './detailsState.ts';
import { ATTENTION_LABELS } from './folderAttention.ts';
import { renderFolderDetails } from './folderDetails.ts';
import { LEAF_REPORT_CSS } from './leafStyles.ts';
import { mountLeafTree } from './leafTreeView.ts';
import {
  installReportMenus,
  renderReportMetrics,
  reportDisclosure
} from './reportDom.ts';
import {
  filterMetricEntries,
  scanMetricEntries
} from './reportMetrics.ts';
import { installReportSplitter } from './reportSplitter.ts';
import { renderScanDetails } from './scanDetails.ts';
import { formatScanFailure } from './scanFailure.ts';

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
  adopt?: (folder: string, knownMarkerPaths: string[]) => Promise<void> | void;
  cancel?: () => void;
  copy: (text: string) => Promise<void>;
  createMissingMarker?: (notePath: string, folderPath: string) => Promise<void>;
  csvBaseUrl?: string;
  exportLeaves: (rows: readonly LeafRow[], filtered: boolean) => Promise<void>;
  exportReport?: (name: string) => Promise<void>;
  exportStatus?: (nodes: LeafTreeNode[], filtered: boolean) => Promise<void>;
  initialContext?: ScanContext;
  openFolder?: (folderPath: string) => Promise<void>;
  openNote?: (notePath: string) => Promise<void>;
  openTemplateSettings?: () => void;
  refresh?: () => Promise<void>;
  repair?: (folder: string, direction: 'external' | 'note') => Promise<void>;
  rescanUnfiltered?: () => Promise<void>;
  resume?: () => Promise<void>;
}
export interface LeafReportView {
  adopted: (folder: string, note: null | string) => void;
  dispose: () => void;
  scanFailure: (failure: null | ScanFailure) => void;
  status: (message: string, busy?: boolean, channel?: 'action' | 'filter' | 'scan') => void;
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
  let issueOrder: IssueOrder = { ids: [], positions: new Map() };
  let adoptionOrder: IssueOrder = { ids: [], positions: new Map() };
  let selectedId: string | undefined;
  let detailNode: LeafTreeNode | undefined;
  let detailSignature = '';
  const query: TreeQuery = { ...DEFAULT_TREE_QUERY };
  let filterRevision = 0;
  let updateRevision = 0;
  let operationRevision = 0;
  let querying = false;
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
  const heading = element('div', '', root, 'leaf-heading-row');
  element('h1', 'External folder status', heading);
  const scanSection = element('section', '', root, 'leaf-scan-section');
  element('h2', 'Scan', scanSection);
  const filterSection = element('section', '', root, 'leaf-filter-section');
  element('h2', 'Filter', filterSection);
  const topActions = element('div', '', scanSection, 'leaf-toolbar leaf-scan-actions');
  const scanTimestamp = element('p', 'No completed scan yet.', scanSection, 'leaf-context leaf-scan-timestamp');
  const scanStatus = element('div', '', scanSection, 'leaf-status leaf-scan-status');
  scanStatus.setAttribute('role', 'status');
  const scanStats = element('dl', '', scanSection, 'leaf-stats leaf-scan-metrics');
  renderReportMetrics(scanStats, scanMetricEntries());
  const coverage = element('p', '', scanSection, 'leaf-context leaf-coverage-notice');
  coverage.hidden = true;
  const problems = element('div', '', scanSection, 'leaf-warning leaf-scan-problems');
  problems.hidden = true;
  const problemText = element('p', '', problems);
  action('View scan problems', problems, () => {
    scanDetails.open = true;
    const groups = scanIssues.querySelectorAll<HTMLDetailsElement>('[data-scan-category="problems"], [data-scan-category="markers"]');
    for (const group of groups) {
      group.open = true;
    }
    const target = groups[0]?.querySelector('summary') ?? scanDetails.querySelector('summary');
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  });
  const warning = element('div', '', scanSection, 'leaf-warning');
  warning.hidden = true;
  const scanDetails = reportDisclosure(scanSection, 'Scan details');
  const failedAttempt = element('section', '', scanDetails, 'leaf-failed-attempt');
  failedAttempt.hidden = true;
  element('h3', 'Latest scan attempt', failedAttempt);
  const failureText = element('pre', '', failedAttempt, 'leaf-context leaf-scan-error');
  failureText.tabIndex = 0;
  const copyFeedback = element('span', '', failedAttempt);
  copyFeedback.setAttribute('role', 'status');
  action('Copy error', failedAttempt, async () => {
    try {
      await host.copy(failureText.textContent);
      copyFeedback.textContent = 'Error copied.';
    } catch {
      copyFeedback.textContent = 'Could not copy. Select the error text to copy it manually.';
    }
  });
  const context = element('div', '', scanDetails, 'leaf-context');
  const scanIssues = element('div', '', scanDetails);
  function renderCoverage(next: LeafReportModel): void {
    const issues = next.coverage?.issues ?? [];
    renderScanDetails(scanIssues, issues);
    coverage.textContent = coverageNotice(next);
    coverage.hidden = coverage.textContent.length === 0;
    problemText.textContent = scanProblemSummary(issues);
    problems.hidden = problemText.textContent.length === 0;
  }
  const rootInfo = element('div', '', root, 'leaf-root-info');
  root.insertBefore(rootInfo, scanSection);
  const rootLabel = element('p', initialRootLabel(host.initialContext), rootInfo, 'leaf-root-path');
  rootLabel.tabIndex = -1;
  const inspectRoot = action('Inspect external root', rootInfo, async () => {
    if (model?.rootFolder) {
      await jumpTo(model.rootFolder);
    }
  });
  inspectRoot.disabled = true;
  const searchField = element('label', 'Search within results', filterSection, 'leaf-search-field');
  const quickViews = element('div', '', filterSection, 'leaf-quick-views');
  quickViews.setAttribute('role', 'group');
  quickViews.setAttribute('aria-label', 'Quick views');
  const quickButtons = new Map<string, HTMLButtonElement>();
  for (const [key, label] of [['all', 'All folders'], ['adoptable', 'Adoptable leaves'], ['review', 'Needs review']] as const) {
    const button = action(label, quickViews, () => {
      query.adoptableOnly = key === 'adoptable';
      query.needsReview = key === 'review';
      query.mode = 'all';
      changed();
    });
    button.setAttribute('aria-pressed', String(key === 'all'));
    quickButtons.set(key, button);
  }
  const toolbar = element('div', '', filterSection, 'leaf-toolbar');
  const search = element('input', '', searchField);
  search.type = 'search';
  search.placeholder = 'Filter current results by folder or note…';
  search.setAttribute('aria-label', 'Search folders and notes');
  const statusField = element('label', 'Status', toolbar, 'leaf-filter-field');
  const categoryField = element('label', 'Category', toolbar, 'leaf-filter-field');
  const sortField = element('label', 'Sort', toolbar, 'leaf-filter-field');
  const viewMenu = reportDisclosure(toolbar, 'Advanced');
  const viewControls = element('div', '', viewMenu, 'leaf-toolbar');
  const category = element('select', '', categoryField);
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
  const modeField = element('label', 'Folder scope', viewControls, 'leaf-filter-field');
  const mode = element('select', '', modeField);
  mode.setAttribute('aria-label', 'Tree view');
  for (const [value, label] of [['all', 'All scanned folders'], ['results', 'Unmarked leaves']]) {
    element('option', label ?? '', mode).value = value ?? '';
  }
  const statusFilter = element('select', '', statusField);
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
  const sort = element('select', '', sortField);
  sort.setAttribute('aria-label', 'Sort siblings');
  for (const [value, label] of [['name', 'Name'], ['count', 'Most leaves']]) {
    element('option', label ?? '', sort).value = value ?? '';
  }
  const showAll = action('Show all paths', viewControls, async () => {
    query.showGenerated = !query.showGenerated;
    jump = undefined;
    await refilter();
  });
  const refresh = host.refresh ? action('Rescan excluding ignored folders', topActions, host.refresh) : undefined;
  const unfiltered = unfilteredButton();
  function unfilteredButton(): HTMLButtonElement | undefined {
    if (!host.rescanUnfiltered) {
      return undefined;
    }
    const button = action('Rescan entire external directory without filters', topActions, host.rescanUnfiltered);
    button.title = 'Bypass external scan exclusions. Template exclusions and filesystem restrictions still apply.';
    return button;
  }
  const cancel = host.cancel ? action('Cancel', topActions, host.cancel) : undefined;
  if (cancel) {
    cancel.hidden = true;
  }
  const issueControls = element('div', '', root, 'leaf-issue-controls');
  const previousIssue = action('Previous issue', issueControls, () => navigateIssue(-1));
  const issuePosition = element('span', 'No issues in current filters', issueControls);
  issuePosition.setAttribute('role', 'status');
  const nextIssue = action('Next issue', issueControls, () => navigateIssue(1));
  const nextAdoptable = action('Next adoptable leaf', issueControls, navigateAdoptable);
  const adoptionPosition = element('span', 'No adoptable leaves in current filters', issueControls);
  adoptionPosition.setAttribute('role', 'status');
  if (host.resume) {
    action('Resume folder adoption…', issueControls, host.resume);
  }
  const status = element('div', '', root, 'leaf-status');
  status.setAttribute('role', 'status');
  const filterStatus = element('div', '', filterSection, 'leaf-status leaf-filter-status');
  filterStatus.setAttribute('role', 'status');
  const stats = element('dl', '', filterSection, 'leaf-stats leaf-filter-metrics');
  renderReportMetrics(stats, filterMetricEntries());
  const exportMenu = reportDisclosure(scanSection, 'Export scan');
  const exportControls = element('div', '', exportMenu, 'leaf-toolbar');
  const filteredExportMenu = reportDisclosure(filterSection, 'Export filtered results');
  const filteredExportControls = element('div', '', filteredExportMenu, 'leaf-toolbar');
  const disposeMenus = installReportMenus(root, [viewMenu, exportMenu, filteredExportMenu]);
  const activeFilters = element('div', '', filterSection, 'leaf-active-filters');
  activeFilters.setAttribute('aria-label', 'Active filters');
  const filterChips = element('div', '', activeFilters, 'leaf-filter-chips');
  const clearFilters = action('Clear filters', activeFilters, clearAllFilters);
  function clearAllFilters(): void {
    Object.assign(query, { ...DEFAULT_TREE_QUERY, adoptableOnly: false, includeExpected: false, needsReview: false, sort: query.sort, status: '' });
    changed();
  }
  if (host.exportStatus) {
    action('Export filtered status', filteredExportControls, async () => {
      if (result) {
        await host.exportStatus?.(
          [...result.nodes.values()].filter((node) => result?.matched.has(node.id) === true)
            .map((node) => statusExportNode(node, result?.availability.get(node.id), !!model?.stale)),
          true
        );
      }
    });
    action('Export all status', exportControls, async () => {
      if (model) {
        await host.exportStatus?.((model.tree ?? []).map((node) => statusExportNode(node, result?.availability.get(node.id), !!model?.stale)), false);
      }
    });
  }
  const exportFiltered = action('Export filtered unmarked leaves', filteredExportControls, async () => {
    if (result) {
      await host.exportLeaves(result.rows, true);
    }
  });
  const exportAll = action('Export all unmarked leaves', exportControls, async () => {
    if (model) {
      await host.exportLeaves(model.rows, false);
    }
  });
  const reportSelect = element('select', '', exportControls);
  reportSelect.setAttribute('aria-label', 'Audit CSV report');
  for (const name of AUDIT_CSV_NAMES) {
    const option = element('option', name, reportSelect);
    option.value = name;
  }
  const exportReport = host.exportReport ? action('Export selected report', exportControls, () => host.exportReport?.(reportSelect.value)) : undefined;
  if (host.csvBaseUrl !== undefined) {
    const link = element('a', 'Open selected CSV', exportControls);
    function updateLink(): void {
      link.href = `${host.csvBaseUrl ?? ''}${reportSelect.value}`;
      link.download = reportSelect.value;
    }
    updateLink();
    reportSelect.addEventListener('change', updateLink);
  }
  filterSection.insertBefore(activeFilters, filterStatus);
  scanSection.append(topActions);
  element(
    'p',
    'exact = matching note path · yaml = valid note exnf · marker = Contains .exnf marker · ↑ = marker above. Named cell = found · blank = absent · ? unchecked · ⚠ invalid. Evidence columns do not by themselves prove a binding.',
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
  const emptyState = element('div', '', groups, 'leaf-empty');
  emptyState.hidden = true;
  element('p', 'No folders match this view.', emptyState);
  action('Clear filters and show all folders', emptyState, clearAllFilters);
  const detailsPane = element('div', '', layout, 'leaf-details-pane');
  detailsPane.append(issueControls);
  const details = element('aside', '', detailsPane, 'leaf-details');
  details.setAttribute('aria-label', 'Selected folder details');
  const disposeSplitter = installReportSplitter(layout, groups, detailsPane);
  const tree = mountLeafTree(groups, selected, descriptor);
  element('p', 'Generated-path filters only change this view. Unmarked does not mean adoption is required.', root, 'leaf-context');
  function setStatus(message: string, running = busy, channel: 'action' | 'filter' | 'scan' = 'action'): void {
    if (disposed) {
      return;
    }
    busy = running;
    const target = { action: status, filter: filterStatus, scan: scanStatus }[channel];
    target.textContent = message;
    refreshControls();
  }
  function refreshControls(): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-adoption-blocked]')) {
      button.disabled = busy || button.dataset['adoptionBlocked'] === 'true';
    }
    inspectRoot.disabled = busy || querying || !model?.rootFolder;
    if (refresh) {
      refresh.disabled = busy;
    }
    if (unfiltered) {
      unfiltered.disabled = busy;
    }
    if (cancel) {
      cancel.hidden = !busy;
    }
    for (const controls of [exportControls, filteredExportControls]) {
      for (const button of controls.querySelectorAll('button')) {
        button.disabled = busy || querying || !result;
      }
    }
    exportFiltered.disabled = busy || querying || !result;
    exportAll.disabled = busy || querying || !model;
    if (exportReport) {
      exportReport.disabled = busy || querying || !model;
    }
    updateIssueControls();
  }
  function affected(node: LeafTreeNode): [
    string,
    null | string
  ] | undefined {
    return result?.availability.get(node.id)?.operation;
  }

  function descriptor(node: LeafTreeNode): string {
    const overlay = affected(node);
    if (overlay) {
      return overlay[1] === null ? '⚠ Pending recovery' : '✓ Binding changed this session';
    }
    return shortFolderStatus(node);
  }
  function renderDetails(node: LeafTreeNode | undefined, hidden: boolean): void {
    const signature = JSON.stringify([hidden, jump?.targetId, model?.stale, result?.availability.get(node?.id ?? '')]);
    if (node && node === detailNode && signature === detailSignature) {
      return;
    }
    const saved = node?.id === detailNode?.id ? captureDetails(details) : undefined;
    detailNode = node;
    detailSignature = signature;
    detailsAbort?.abort();
    details.replaceChildren();
    details.scrollTop = 0;
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
    let restoreAfterDiagnostics: (() => void) | undefined;
    renderFolderDetails(details, node, {
      availability: result?.availability.get(node.id),
      busy,
      host,
      index: inspection,
      model,
      onError: setStatus,
      onSettled: () => restoreAfterDiagnostics?.(),
      overlay: affected(node),
      select: jumpTo,
      signal: abort.signal
    });
    if (saved) {
      restoreAfterDiagnostics = restoreDetails(details, saved);
    }
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
    selectedId = node?.id;
    updateIssueControls();
    const target = jump?.targetId === inspection?.rootId ? model?.rootFolder : node;
    renderDetails(target, hidden);
  }
  function updateIssueControls(): void {
    previousIssue.disabled = querying || adjacentIssue(issueOrder, selectedId, -1) === undefined;
    nextIssue.disabled = querying || adjacentIssue(issueOrder, selectedId, 1) === undefined;
    nextAdoptable.disabled = querying || busy || adjacentIssue(adoptionOrder, selectedId, 1) === undefined;
    adoptionPosition.textContent = `${String(adoptionOrder.ids.length)} adoptable ${adoptionOrder.ids.length === 1 ? 'leaf' : 'leaves'} in current filters`;
    nextAdoptable.title = adoptionOrder.ids.length
      ? 'Select the next adoptable leaf in the current search and filters. Opens collapsed branches; does not adopt or wrap.'
      : 'No leaves in this view are currently adoptable. Review restrictions, change filters, or refresh stale results.';
    const index = selectedId ? issueOrder.ids.indexOf(selectedId) : -1;
    issuePosition.textContent = index >= 0
      ? `Issue ${String(index + 1)} of ${String(issueOrder.ids.length)}`
      : `${String(issueOrder.ids.length)} issues in current filters`;
  }
  async function navigateAdoptable(): Promise<void> {
    const id = adjacentIssue(adoptionOrder, selectedId, 1);
    if (id && result && !busy && !querying) {
      jump = undefined;
      await tree.update(result, query.search);
      await tree.select(id);
    }
  }
  async function navigateIssue(direction: -1 | 1): Promise<void> {
    const id = adjacentIssue(issueOrder, selectedId, direction);
    if (id && result) {
      jump = undefined;
      await tree.update(result, query.search);
      await tree.select(id);
    }
  }
  async function jumpTo(node: LeafTreeNode): Promise<void> {
    if (!result || node.hiddenByCoverage) {
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
    querying = true;
    root.setAttribute('aria-busy', 'true');
    queryAbort?.abort();
    const abort = new AbortController();
    queryAbort = abort;
    if (!model) {
      return;
    }
    refreshControls();
    const input = model;
    try {
      const filtered = await runAuditSteps(queryTreeSteps(input, { ...query }, new Map(adoptions)), { signal: abort.signal });
      const order = await runAuditSteps(issueOrderSteps(filtered), { signal: abort.signal });
      const adoptable = await runAuditSteps(adoptableLeafOrderSteps(filtered), { signal: abort.signal });
      if (disposed || abort.signal.aborted || revision !== filterRevision) {
        return;
      }
      await applyResult(filtered, order, adoptable);
      if (revision === filterRevision) {
        querying = false;
        root.setAttribute('aria-busy', 'false');
        refreshControls();
        updateIssueControls();
      }
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        throw error;
      }
    }
  }
  async function applyResult(filtered: TreeResult, order: IssueOrder, adoptable: IssueOrder, reset = false): Promise<void> {
    result = filtered;
    issueOrder = order;
    adoptionOrder = adoptable;
    updateIssueControls();
    renderReportMetrics(stats, filterMetricEntries(filtered));
    renderActiveFilters();
    emptyState.hidden = filtered.matched.size > 0;
    await tree.update(jump ? revealTreePath(filtered, jump.targetId, query.sort) : filtered, query.search, reset);
    if (result === filtered) {
      refreshControls();
    }
  }
  function renderActiveFilters(): void {
    syncFilterControls();
    const filters: { label: string; reset: () => void }[] = [
      {
        label: query.search ? `Search: ${query.search}` : '',
        reset: (): void => {
          query.search = '';
        }
      },
      {
        label: query.category === 'all' ? '' : `Category: ${category.selectedOptions[0]?.textContent ?? query.category}`,
        reset: (): void => {
          query.category = 'all';
        }
      },
      {
        label: query.mode === 'all' ? '' : 'Unmarked leaves',
        reset: (): void => {
          query.mode = 'all';
        }
      },
      {
        label: query.status ?? '',
        reset: (): void => {
          query.status = '';
        }
      },
      {
        label: query.needsReview ? 'Needs review' : '',
        reset: (): void => {
          query.needsReview = false;
        }
      },
      {
        label: query.adoptableOnly ? 'Adoptable leaves' : '',
        reset: (): void => {
          query.adoptableOnly = false;
        }
      },
      {
        label: query.showGenerated ? '' : 'Generated paths hidden',
        reset: (): void => {
          query.showGenerated = true;
        }
      },
      {
        label: query.includeExpected ? 'Expected paths included' : '',
        reset: (): void => {
          query.includeExpected = false;
        }
      }
    ];
    filterChips.replaceChildren();
    for (const filter of filters.filter((item) => !!item.label)) {
      const chip = action(`${filter.label} ×`, filterChips, () => {
        filter.reset();
        changed();
        search.focus();
      });
      chip.setAttribute('aria-label', `Remove filter: ${filter.label}`);
    }
    clearFilters.hidden = !filterChips.childElementCount;
    activeFilters.hidden = clearFilters.hidden;
    const advancedSummary = viewMenu.querySelector('summary');
    if (advancedSummary) {
      advancedSummary.textContent = `Advanced${query.mode !== 'all' || !query.showGenerated || query.includeExpected ? ' •' : ''}`;
    }
  }
  function syncFilterControls(): void {
    search.value = query.search;
    category.value = query.category;
    mode.value = query.mode;
    statusFilter.value = query.status ?? '';
    expectedToggle.setAttribute('aria-pressed', String(!!query.includeExpected));
    showAll.textContent = 'Include generated/internal paths';
    showAll.setAttribute('aria-pressed', String(query.showGenerated));
    const currentView = query.adoptableOnly ? 'adoptable' : 'all';
    for (const [key, button] of quickButtons) {
      button.setAttribute('aria-pressed', String(key === (query.needsReview ? 'review' : currentView)));
    }
  }
  function changed(preserveJump = false): void {
    filterStatus.textContent = '';
    if (!preserveJump) {
      jump = undefined;
    }
    refilter().catch(() => {
      setStatus('Filtering failed.', busy, 'filter');
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
  function retainedOperations(next: LeafReportModel, initialOperations: number): Map<string, null | string> {
    const sameRoots = !model || (model.externalRoot === next.externalRoot && model.vaultRoot === next.vaultRoot);
    if (sameRoots && initialOperations !== operationRevision) {
      next.stale = true;
    }
    return new Map([...adoptions].filter(([, note]) => sameRoots && (note === null || !!next.stale)));
  }
  async function prepareUpdate(next: LeafReportModel, signal?: AbortSignal): Promise<{
    adoptable: IssueOrder;
    availableStatuses: string[];
    filtered: TreeResult;
    nextStatus: string;
    order: IssueOrder;
    retained: Map<string, null | string>;
  }> {
    const availableStatuses = availableTreeStatuses(next.tree ?? []);
    let filtered: TreeResult;
    let order: IssueOrder;
    let adoptable: IssueOrder;
    let captured: string;
    let nextStatus: string;
    let changesAtQuery: number;
    let retained: Map<string, null | string>;
    const initialOperations = operationRevision;
    do {
      changesAtQuery = operationRevision;
      retained = retainedOperations(next, initialOperations);
      nextStatus = retainAvailableTreeStatus(query.status, availableStatuses);
      captured = JSON.stringify(query);
      filtered = await runAuditSteps(queryTreeSteps(next, { ...query, status: nextStatus }, retained), signal ? { signal } : {});
      order = await runAuditSteps(issueOrderSteps(filtered), signal ? { signal } : {});
      adoptable = await runAuditSteps(adoptableLeafOrderSteps(filtered), signal ? { signal } : {});
    } while (captured !== JSON.stringify(query) || changesAtQuery !== operationRevision);
    return { adoptable, availableStatuses, filtered, nextStatus, order, retained };
  }
  setStatus('Ready.', false);
  updateIssueControls();
  return {
    adopted(folder, note): void {
      operationRevision++;
      adoptions.set(folder, note);
      if (model) {
        model.stale = true;
      }
      warning.hidden = false;
      warning.textContent = 'This snapshot predates mutations. Refresh to update results and counts. Pending operations can be resumed.';
      for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-adoption-blocked]')) {
        button.disabled = true;
        button.dataset['adoptionBlocked'] = 'true';
      }
      changed(true);
    },
    dispose(): void {
      disposed = true;
      queryAbort?.abort();
      detailsAbort?.abort();
      disposeMenus();
      disposeSplitter();
      tree.dispose();
      root.remove();
    },
    scanFailure(failure): void {
      if (disposed) {
        return;
      }
      failureText.textContent = failure ? formatScanFailure(failure) : '';
      copyFeedback.textContent = '';
      failedAttempt.hidden = !failure;
      if (failure) {
        if (!model && failure.externalRoot) {
          rootLabel.textContent = failure.externalRoot;
        }
        scanDetails.open = true;
      }
    },
    status: setStatus,
    async update(next, signal): Promise<void> {
      if (disposed) {
        return;
      }
      const revision = ++updateRevision;
      const { adoptable, availableStatuses, filtered, nextStatus, order, retained } = await prepareUpdate(next, signal);
      signal?.throwIfAborted();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose can run while scheduled analysis is awaiting.
      if (disposed || revision !== updateRevision) {
        return;
      }
      filterRevision++;
      querying = false;
      root.setAttribute('aria-busy', 'false');
      queryAbort?.abort();
      const reset = !!model && (model.externalRoot !== next.externalRoot || model.vaultRoot !== next.vaultRoot);
      model = next;
      query.status = nextStatus;
      inspection = createInspectionIndex(next);
      detailSignature = '';
      jump = undefined;
      statusFilter.replaceChildren();
      element('option', 'All statuses', statusFilter).value = '';
      for (const value of availableStatuses) {
        element('option', value, statusFilter).value = value;
      }
      statusFilter.value = query.status ?? '';
      rootLabel.textContent = next.externalRoot;
      renderReportMetrics(scanStats, scanMetricEntries(next));
      if (!host.refresh) {
        scanStatus.textContent = 'Completed snapshot loaded.';
      }
      const completedAt = new Date(next.finishedAt);
      scanTimestamp.textContent = `${scanLabel(next)} · Last scanned: ${Number.isNaN(completedAt.getTime()) ? next.finishedAt : completedAt.toLocaleString()}`;
      adoptions.clear();
      for (const [folder, note] of retained) {
        adoptions.set(folder, note);
      }
      context.textContent = `Vault: ${next.vaultRoot}\nExternal root: ${next.externalRoot}\nScanned: ${next.startedAt} – ${next.finishedAt}\nCoverage: ${
        next.uncheckedCount > 0 ? 'incomplete' : 'complete'
      }`;
      context.textContent += extraScanContext(next);
      renderCoverage(next);
      warning.textContent = [
        ...(next.uncheckedBindings ?? []),
        next.stale ? 'This snapshot predates mutations. Refresh to update results and counts.' : '',
        next.mutationWarning ? 'Results may not reflect in-progress mutations.' : ''
      ].filter(Boolean).join(' ');
      warning.hidden = warning.textContent.length === 0;
      await applyResult(filtered, order, adoptable, reset);
    }
  };
}

function extraScanContext(model: LeafReportModel): string {
  return [model.scanSummary, model.templateExclusionSummary].filter((text): text is string => typeof text === 'string').map((text) => `\n${text}`).join('');
}
function initialRootLabel(context?: ScanContext): string {
  return context?.externalRoot ?? 'External root unavailable';
}
function scanLabel(model: LeafReportModel): string {
  return model.statusScanMode ? `${model.statusScanMode === 'filtered' ? 'Filtered' : 'Unfiltered'} external scan` : 'Physical audit';
}
