import type { InspectionIndex } from '../core/folderInspection.ts';
import type {
  LeafNoteMatch,
  LeafReportModel
} from '../core/leafQuery.ts';
import type { LeafTreeNode } from '../core/leafTree.ts';
import type { FolderChange } from './folderAttention.ts';
import type { LeafReportHost } from './leafReportView.ts';

import { runAuditSteps } from '../auditScheduler.ts';
import {
  adoptionBlockerSteps,
  descendantMarkerExplanation,
  evidenceExplanation,
  markedAncestors,
  shortFolderStatus
} from '../core/folderInspection.ts';
import {
  ATTENTION_LABELS,
  detailExplanations,
  folderAttention
} from './folderAttention.ts';
import {
  reportAction,
  reportDisclosure,
  reportElement
} from './reportDom.ts';

interface FolderDetailsOptions {
  busy: boolean;
  host: LeafReportHost;
  index: InspectionIndex;
  model: LeafReportModel;
  onError: (message: string) => void;
  overlay: [string, null | string] | undefined;
  select: (node: LeafTreeNode) => Promise<void>;
  signal: AbortSignal;
}

export function paged<T>(parent: HTMLElement, items: T[], render: (item: T) => void): void {
  const pageSize = 50;
  let count = 0;
  const more = reportElement(parent, 'button', 'Show next 50');
  more.type = 'button';
  function show(): void {
    for (const item of items.slice(count, count + pageSize)) {
      render(item);
    }
    count += pageSize;
    more.hidden = count >= items.length;
    parent.append(more);
  }
  more.addEventListener('click', show);
  show();
}

export function renderFolderDetails(parent: HTMLElement, node: LeafTreeNode, options: FolderDetailsOptions): void {
  const { host, index, model } = options;
  const isRoot = node.id === index.rootId;
  reportElement(parent, 'h2', isRoot ? 'External root' : node.relativePath);
  reportElement(parent, 'p', shortFolderStatus(node), 'leaf-tags');
  let change: FolderChange;
  if (options.overlay) {
    change = options.overlay[1] === null ? 'pending' : 'changed';
  }
  const attention = folderAttention(node, change);
  const attentionLabel = reportElement(parent, 'p', ATTENTION_LABELS[attention], 'leaf-attention');
  attentionLabel.dataset['tone'] = attention;
  reportElement(parent, 'p', statusDescription(node));
  const navigation = reportElement(parent, 'div', '', 'leaf-toolbar');
  button(navigation, 'Copy path', () => host.copy(node.folderPath));
  if (host.openFolder && node.kind === 'directory') {
    button(navigation, 'Open folder', () => host.openFolder?.(node.folderPath));
  }
  renderRelationship();
  renderActions();
  const evidence = reportDisclosure(parent, `Associated notes (${String(node.notes.length)})`);
  evidence.open = true;
  if (!node.notes.length) {
    reportElement(evidence, 'p', 'No note is associated by expected path or UUID.');
  }
  paged(evidence, node.notes, (note) => {
    renderNote(evidence, note, `${note.association ?? 'Associated'} note`);
  });
  const candidates = node.evidence?.candidates ?? [];
  if (candidates.length) {
    const suggestions = reportDisclosure(parent, `Other notes with this name (${String(candidates.length)})`);
    suggestions.open = true;
    reportElement(suggestions, 'p', 'Name matches only — a matching name does not establish a binding.');
    paged(suggestions, candidates, (note) => {
      renderNote(suggestions, note, 'Same-name candidate');
    });
  }
  const technical = reportDisclosure(parent, 'Technical and scan details');
  technical.open = true;
  reportElement(technical, 'p', node.folderPath, 'leaf-context');
  reportElement(technical, 'p', `${String(node.total)} known physical leaves in this branch.`, 'leaf-context');
  const markerList = reportElement(technical, 'div');
  paged(markerList, node.inspection?.markers ?? [], (marker) => {
    reportElement(markerList, 'p', `${marker.markerPath}\n${marker.format} · ${marker.status}\nUUID: ${marker.uuid || 'Unknown'}`, 'leaf-context');
  });
  const explanations = reportElement(technical, 'div');
  paged(explanations, detailExplanations(node), (text) => {
    reportElement(explanations, 'p', text, 'leaf-context');
  });
  if (node.evidence?.confidence === 'provisional') {
    reportElement(technical, 'p', 'Incomplete identity coverage may conceal another use of a UUID. Found evidence remains useful; uniqueness is provisional.');
  }

  function button(target: HTMLElement, label: string, callback: () => Promise<void> | void): HTMLButtonElement {
    return reportAction(target, label, callback, options.onError);
  }
  function renderNote(target: HTMLElement, note: LeafNoteMatch, label: string): void {
    const item = reportElement(target, 'div', '', 'leaf-note');
    reportElement(item, 'p', `${label}: ${note.notePath}`);
    reportElement(item, 'p', noteIdentityLabel(note.status), 'leaf-context');
    if (host.openNote) {
      button(item, 'Open note', () => host.openNote?.(note.notePath));
    }
    button(item, 'Copy note path', () => host.copy(note.absolutePath));
  }
  function renderRelationship(): void {
    const binding = node.evidence?.bindingNote;
    if (binding) {
      reportElement(parent, 'h3', 'This folder’s binding');
      reportElement(parent, 'p', `Associated note: ${binding}`);
      if (host.openNote) {
        button(parent, 'Open associated note', () => host.openNote?.(binding));
      }
      if (node.evidence?.status === 'Bound at different path') {
        reportElement(parent, 'p', `Actual: ${node.folderPath}\nExpected: ${node.evidence.expectedFolder ?? ''}`, 'leaf-context');
      }
    }
    const ancestors = markedAncestors(index, node);
    const nearest = ancestors.next().value as LeafTreeNode | undefined;
    if (nearest) {
      renderAncestor(parent, nearest);
      const others = [...ancestors];
      if (others.length) {
        const section = reportDisclosure(parent, `Other marked ancestors (${String(others.length)}) — overlapping marker evidence`);
        section.open = true;
        paged(section, others, (ancestor) => {
          renderAncestor(section, ancestor);
        });
      }
    }
    for (const folder of node.evidence?.relatedFolders ?? []) {
      if (folder !== node.folderPath) {
        reportElement(parent, 'p', `Matching UUID found at: ${folder}`, 'leaf-context');
      }
    }
  }
  function renderAncestor(target: HTMLElement, ancestor: LeafTreeNode): void {
    const card = reportElement(target, 'div', '', 'leaf-relationship');
    const distance = node.segments.length - ancestor.segments.length;
    const name = ancestor.relativePath || 'External root';
    reportElement(card, 'h3', 'Marker above this folder');
    reportElement(card, 'p', `${name} contains a .exnf marker, ${String(distance)} ${distance === 1 ? 'level' : 'levels'} above.`);
    if (ancestor.evidence?.marker !== 'present') {
      reportElement(card, 'p', evidenceExplanation(ancestor, 'marker'), 'leaf-context');
    }
    const confirmed = ancestor.evidence?.confidence === 'checked' && !!ancestor.evidence.bindingNote;
    reportElement(
      card,
      'p',
      confirmed
        ? `This is content inside the folder bound to ${ancestor.evidence?.bindingNote ?? ''}. It does not need a separate binding.`
        : 'Ancestor marker found; its binding is unresolved or provisional. Inspect its evidence before treating it as bound.'
    );
    button(card, 'Select marked ancestor', () => options.select(ancestor));
    if (host.openFolder && ancestor.kind === 'directory') {
      button(card, 'Open ancestor folder', () => host.openFolder?.(ancestor.folderPath));
    }
    if (host.openNote && ancestor.evidence?.bindingNote) {
      const note = ancestor.evidence.bindingNote;
      button(card, 'Open associated note', () => host.openNote?.(note));
    }
  }
  function renderActions(): void {
    if (isRoot || node.kind === 'virtual') {
      return;
    }
    const stale = !!model.stale;
    const pending = options.overlay?.[1] === null;
    const blocked = node.blocked || index.vaultIssueIds.length > 0 || stale || !!options.overlay;
    if (host.adopt) {
      const adopt = button(parent, 'Adopt this folder…', () => host.adopt?.(node.folderPath));
      adopt.disabled = options.busy || blocked;
      adopt.dataset['adoptionBlocked'] = String(blocked);
      if (!blocked) {
        reportElement(parent, 'p', 'Choose a note to check adoption. Preview checks depend on the selected note and mode.');
      }
    }
    if (pending) {
      reportElement(parent, 'p', `An unfinished operation affects ${options.overlay?.[0] ?? node.folderPath}. Inspect or resume it before continuing.`);
      if (host.resume) {
        button(parent, 'Review pending operation', host.resume);
      }
    } else if (stale || options.overlay) {
      reportElement(parent, 'p', 'This snapshot predates a binding change. Refresh to check current evidence and available actions.');
      if (host.refresh) {
        button(parent, 'Refresh status', host.refresh);
      }
    }
    const blockers = reportElement(parent, 'div', '', 'leaf-blockers');
    runAuditSteps(adoptionBlockerSteps(index, node), { signal: options.signal }).then((items) => {
      if (options.signal.aborted) {
        return;
      }
      if (items.length) {
        reportElement(blockers, 'p', `${String(items.length)} known adoption ${items.length === 1 ? 'restriction' : 'restrictions'}:`);
      }
      paged(blockers, items, (item) => {
        reportElement(blockers, 'p', `${item.message}\n${item.location}`, 'leaf-context');
        const target = index.nodes.get(item.nodeId ?? '');
        if (target && target.id !== node.id) {
          button(blockers, 'Inspect affected folder', () => options.select(target));
        }
      });
    }).catch((error: unknown) => {
      if (!options.signal.aborted) {
        options.onError(error instanceof Error ? error.message : 'Could not inspect restrictions.');
      }
    });
    renderRepairActions(stale);
  }
  function renderRepairActions(stale: boolean): void {
    if (host.repair && node.evidence?.status === 'Bound at different path' && node.evidence.confidence === 'checked') {
      for (const direction of ['external', 'note'] as const) {
        const label = direction === 'external' ? 'Move external folder to match note…' : 'Move note to match external folder…';
        const repair = button(parent, label, () => host.repair?.(node.folderPath, direction));
        repair.disabled = options.busy || stale || !!options.overlay;
        repair.dataset['adoptionBlocked'] = String(stale || !!options.overlay);
        reportElement(
          parent,
          'p',
          direction === 'external'
            ? 'Moves this folder and all its contents.'
            : 'Moves only the selected markdown note. Link updates follow Obsidian settings.',
          'leaf-context'
        );
      }
    }
  }
}

function noteIdentityLabel(status: string): string {
  const labels: Record<string, string> = {
    'duplicate-uuid': 'Duplicate note UUID',
    'invalid-property': 'Invalid exnf property',
    'missing-property': 'YAML exnf not found',
    'unchecked-frontmatter': 'Note identity unchecked; file path discovered',
    'valid': 'Valid exnf UUID'
  };
  return labels[status] ?? status;
}

function statusDescription(node: LeafTreeNode): string {
  if (node.evidence?.status === 'Contains bound subfolders' || node.evidence?.status === 'Contains descendant markers') {
    return descendantMarkerExplanation(node);
  }
  if (node.evidence?.status.startsWith('Bound at ') && node.evidence.confidence === 'provisional') {
    return 'The note and marker UUIDs match. Scan gaps prevent proving that this binding is unique; see scan details.';
  }
  const descriptions: Record<string, string> = {
    'Bound at different path': 'The note and local marker match by UUID; their paths differ.',
    'Bound at expected path': 'The note and local marker identify the same folder at its expected path.',
    'Excluded from scan': 'This branch was excluded by the command’s scan settings. Its contents were not inspected.',
    'Identity conflict': 'Identities disagree or marked folders overlap. Inspect the evidence before making changes.',
    'Inside a marked folder': 'This folder is inside a folder containing marker evidence. See its ancestor relationship below.',
    'Unassigned folder': 'No direct note association or local marker was found. Ordinary content folders do not need adoption.',
    'Unchecked': 'Some evidence for this folder could not be checked. The reasons are available below.'
  };
  return descriptions[node.evidence?.status ?? ''] ?? 'Inspect the note associations and evidence before deciding whether to change this folder’s binding.';
}
