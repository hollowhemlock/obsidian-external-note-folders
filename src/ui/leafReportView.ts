import type {
  LeafReportModel,
  LeafRow
} from '../core/leafQuery.ts';
import type {
  LeafTreeNode,
  TreeQuery,
  TreeResult
} from '../core/leafTree.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import {
  DEFAULT_TREE_QUERY,
  descendantIssueSteps,
  queryTreeSteps
} from '../core/leafTree.ts';
import { LEAF_REPORT_CSS } from './leafStyles.ts';
import { mountLeafTree } from './leafTreeView.ts';

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
  let result: TreeResult | undefined;
  const query: TreeQuery = { ...DEFAULT_TREE_QUERY };
  let filterRevision = 0;
  let updateRevision = 0;
  let detailsAbort: AbortController | undefined;
  let queryAbort: AbortController | undefined;
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
  const mode = element('select', '', toolbar);
  mode.setAttribute('aria-label', 'Tree view');
  for (const [value, label] of [['results', 'Result branches'], ['all', 'All scanned folders']]) {
    element('option', label ?? '', mode).value = value ?? '';
  }
  const sort = element('select', '', toolbar);
  sort.setAttribute('aria-label', 'Sort siblings');
  for (const [value, label] of [['name', 'Name'], ['count', 'Most unmarked leaves']]) {
    element('option', label ?? '', sort).value = value ?? '';
  }
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
  const rootLabel = element('h2', '', root);
  element(
    'p',
    'Legend: ◆ exact note match · ▣ marker evidence · ✓ adopted this session · ⚠ unchecked / pending · ! conflict. Badges are evidence, not verified bindings.',
    root,
    'leaf-legend'
  );
  const layout = element('div', '', root, 'leaf-layout');
  const groups = element('div', '', layout);
  const details = element('aside', '', layout, 'leaf-details');
  details.setAttribute('aria-label', 'Selected folder details');
  const tree = mountLeafTree(groups, renderDetails, badges);
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
    const rowDetails = element('details', '', parent, 'leaf-row');
    element('summary', row.relativePath, rowDetails);
    element(
      'div',
      row.categories.length
        ? row.categories.map((categoryName) =>
          ({ dependencies: 'Dependencies', generated: 'Likely build / cache / environment', git: 'Git internals' })[categoryName]
        ).join(' · ')
        : 'Ordinary path',
      rowDetails,
      'leaf-tags'
    );
    element('p', row.folderPath, rowDetails, 'leaf-context');
    const actions = element('div', '', rowDetails, 'leaf-toolbar');
    action('Copy path', actions, () => host.copy(row.folderPath));
    if (host.openFolder) {
      action('Open folder', actions, () => host.openFolder?.(row.folderPath));
    }
    if (row.notes.length > 1) {
      element('p', 'Multiple notes derive this folder. This is not proof of a binding.', rowDetails);
    }
    for (const note of row.notes) {
      const match = element('div', `${note.notePath} — ${identityLabel(note.status)}`, rowDetails, 'leaf-note');
      if (host.openNote) {
        action('Open note', match, () => host.openNote?.(note.notePath));
      }
      action('Copy note path', match, () => host.copy(note.absolutePath));
    }
    if (row.notes.length === 0) {
      element('p', 'No exact note path match.', rowDetails, 'leaf-context');
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
  function markerBadge(node: LeafTreeNode): string {
    if (node.markers.length) {
      return '▣ Marker present';
    }
    return node.covered ? '▣ Ancestor marker' : '';
  }
  function adoptionBadge(node: LeafTreeNode): string {
    const overlay = affected(node);
    if (!overlay) {
      return '';
    }
    return overlay[1] ? '✓ Adopted this session' : '⚠ Pending recovery';
  }
  function badges(node: LeafTreeNode): string {
    return [
      node.notes.length ? '◆ Note match' : '',
      markerBadge(node),
      node.kind === 'link' ? '↗ Skipped link' : '',
      node.unchecked ? '⚠ Unchecked' : '',
      node.conflict ? '! Conflict' : '',
      node.descendantIssues ? '⚠ Descendant issues' : '',
      adoptionBadge(node)
    ].filter(Boolean).map((label) => ` · ${label}`).join('');
  }
  function renderDetails(node: LeafTreeNode | undefined, hidden: boolean): void {
    detailsAbort?.abort();
    details.replaceChildren();
    if (!node) {
      element('p', 'Select a folder to inspect paths, note matches, and actions.', details);
      return;
    }
    element('h2', node.relativePath, details);
    if (hidden) {
      element('p', 'Selected folder is hidden by the current filters.', details, 'leaf-warning');
    }
    element(
      'p',
      `${
        (result?.counts.get(node.id) ?? 0).toLocaleString()
      }/${node.total.toLocaleString()} known unmarked leaves. Actions cover the entire folder subtree, including hidden paths.`,
      details
    );
    element('p', badges(node), details, 'leaf-tags');
    renderRow(node, details);
    const rowDetails = details.querySelector('details');
    if (rowDetails) {
      rowDetails.open = true;
    }
    for (const evidence of [...node.markers, ...node.issues]) {
      element('p', evidence, details, 'leaf-context');
    }
    if (node.descendantIssues) {
      const evidence = element('div', '', details);
      const inspect = action('Inspect descendant issues', evidence, async () => {
        if (!result) {
          return;
        }
        detailsAbort?.abort();
        const abort = new AbortController();
        detailsAbort = abort;
        inspect.disabled = true;
        try {
          const nodes = await runAuditSteps(descendantIssueSteps(result, node.id), { signal: abort.signal });
          if (abort.signal.aborted) {
            return;
          }
          const pageSize = 100;
          let count = 0;
          const more = action('Show next 100 issues', evidence, show);
          function show(): void {
            for (const issueNode of nodes.slice(count, count + pageSize)) {
              element('p', [issueNode.folderPath, ...issueNode.issues, ...issueNode.markers].join('\n'), evidence, 'leaf-context');
              for (const note of issueNode.notes) {
                element('p', `${note.absolutePath} — ${identityLabel(note.status)}`, evidence, 'leaf-context');
              }
            }
            count += pageSize;
            more.hidden = count >= nodes.length;
          }
          show();
        } catch (error: unknown) {
          if (!abort.signal.aborted) {
            throw error;
          }
        }
      });
    }
    const overlay = affected(node);
    if (host.adopt) {
      const blocked = node.blocked || !!overlay;
      const button = action('Adopt this folder…', details, () => host.adopt?.(node.folderPath));
      button.disabled = busy || blocked;
      button.dataset['adoptionBlocked'] = String(blocked);
      if (blocked) {
        element(
          'p',
          overlay
            ? 'An overlapping folder was adopted or needs recovery. Refresh or resume the pending operation.'
            : 'Adoption is blocked by overlapping marker evidence, a skipped link, or unchecked topology.',
          details
        );
      } else {
        element('p', 'Preview and fresh safety checks are required before confirmation.', details, 'leaf-context');
      }
    }
    if (overlay?.[1] && host.openNote) {
      action('Open adopted note', details, () => host.openNote?.(overlay[1] ?? ''));
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
    stats.textContent = `${
      model?.rows.length.toLocaleString() ?? '0'
    } known unmarked leaves · ${filtered.rows.length.toLocaleString()} displayed · ${filtered.hiddenCount.toLocaleString()} generated/internal paths hidden`;
    showAll.textContent = query.showGenerated ? 'Hide generated/internal paths' : 'Show all generated/internal paths';
    showAll.setAttribute('aria-pressed', String(query.showGenerated));
    await tree.update(filtered, query.search, reset);
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
    query.category = category.value as TreeQuery['category'];
    changed();
  });
  mode.addEventListener('change', () => {
    query.mode = mode.value as TreeQuery['mode'];
    changed();
  });
  sort.addEventListener('change', () => {
    query.sort = sort.value as TreeQuery['sort'];
    changed();
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
      tree.dispose();
      root.remove();
    },
    status: setStatus,
    async update(next, signal): Promise<void> {
      if (disposed) {
        return;
      }
      const revision = ++updateRevision;
      let filtered: TreeResult;
      let captured: string;
      do {
        captured = JSON.stringify(query);
        filtered = await runAuditSteps(queryTreeSteps(next, { ...query }), signal ? { signal } : {});
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
      rootLabel.textContent = next.externalRoot;
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
      await applyResult(filtered, reset);
    }
  };
}
