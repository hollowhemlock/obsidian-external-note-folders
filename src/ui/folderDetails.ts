import type { FolderAvailability } from '../core/folderAvailability.ts';
import type { InspectionIndex } from '../core/folderInspection.ts';
import type {
  LeafNoteMatch,
  LeafReportModel
} from '../core/leafQuery.ts';
import type { LeafTreeNode } from '../core/leafTree.ts';
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
  detailExplanations
} from './folderAttention.ts';
import {
  reportAction,
  reportDisclosure,
  reportElement
} from './reportDom.ts';

interface FolderDetailsOptions {
  availability: FolderAvailability | undefined;
  busy: boolean;
  host: LeafReportHost;
  index: InspectionIndex;
  model: LeafReportModel;
  onError: (message: string) => void;
  onSettled: () => void;
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
  const header = reportElement(parent, 'div', '', 'leaf-details-header');
  header.dataset['section'] = 'header';
  const heading = reportElement(header, 'h2', isRoot ? 'External root' : node.segments.at(-1) ?? node.relativePath);
  heading.tabIndex = -1;
  heading.dataset['detailKey'] = 'section:header';
  reportElement(header, 'p', shortFolderStatus(node), 'leaf-tags');
  const attention = options.availability?.attention ?? 'neutral';
  reportElement(header, 'p', ATTENTION_LABELS[attention], 'leaf-attention').dataset['tone'] = attention;
  if (node.segments.length > 1) {
    reportElement(header, 'p', node.relativePath, 'leaf-context leaf-relative-path');
  }
  const navigation = reportElement(header, 'div', '', 'leaf-toolbar');
  button(navigation, 'Copy path', () => host.copy(node.folderPath));
  if (host.openFolder && node.kind === 'directory') {
    button(navigation, 'Open folder', () => host.openFolder?.(node.folderPath));
  }
  const relationship = section(parent, 'Binding relationship', 'relationship');
  reportElement(relationship, 'p', statusDescription(node));
  renderRelationship(relationship);
  if (!isRoot && node.kind !== 'virtual') {
    renderActions(section(parent, 'Available actions', 'actions'));
  }
  const evidence = section(parent, `Associated notes (${String(node.notes.length)})`, 'notes');
  if (!node.notes.length) {
    reportElement(evidence, 'p', 'No note is associated by expected path or UUID.');
  }
  paged(evidence, node.notes, (note) => {
    renderNote(evidence, note, `${note.association ?? 'Associated'} note`);
  });
  const candidates = node.evidence?.candidates ?? [];
  if (candidates.length) {
    const suggestions = section(parent, `Same-name suggestions (${String(candidates.length)})`, 'suggestions');
    reportElement(suggestions, 'p', 'Name matches only — a matching name does not establish a binding.');
    paged(suggestions, candidates, (note) => {
      renderNote(suggestions, note, 'Same-name candidate');
    });
  }
  const technical = section(parent, 'Technical and scan details', 'technical');
  pathField(technical, 'Absolute folder path', node.folderPath);
  reportElement(technical, 'p', `${String(node.total)} known physical leaves in this branch.`, 'leaf-context');
  const markerList = reportElement(technical, 'div');
  paged(markerList, node.inspection?.markers ?? [], (marker) => {
    reportElement(markerList, 'p', `${marker.markerPath}\n${marker.format} · ${marker.status}\nUUID: ${marker.uuid || 'Unknown'}`, 'leaf-context');
  });
  const explanations = reportElement(technical, 'div');
  paged(explanations, detailExplanations(node).filter((text) => text !== statusDescription(node)), (text) => {
    reportElement(explanations, 'p', text, 'leaf-context');
  });
  if (node.evidence?.confidence === 'provisional') {
    reportElement(technical, 'p', 'Incomplete identity coverage may conceal another use of a UUID. Found evidence remains useful; uniqueness is provisional.');
  }

  function button(target: HTMLElement, label: string, callback: () => Promise<void> | void): HTMLButtonElement {
    const control = reportAction(target, label, callback, options.onError);
    control.dataset['detailKey'] = JSON.stringify([
      target.closest<HTMLElement>('[data-section]')?.dataset['section'],
      target.closest<HTMLElement>('[data-record]')?.dataset['record'],
      label
    ]);
    return control;
  }
  function section(target: HTMLElement, label: string, key: string): HTMLDetailsElement {
    const item = reportDisclosure(target, label);
    item.open = true;
    item.dataset['section'] = key;
    const summary = item.querySelector('summary');
    if (!summary) {
      throw new Error('Missing details heading.');
    }
    summary.dataset['detailKey'] = `section:${key}`;
    return item;
  }
  function pathField(target: HTMLElement, label: string, value: string): void {
    const field = reportElement(target, 'div', '', 'leaf-path-field');
    field.dataset['record'] = `${label}:${value}`;
    reportElement(field, 'strong', label);
    reportElement(field, 'span', value, 'leaf-path-value');
    button(field, `Copy ${label.toLowerCase()}`, () => host.copy(value));
  }
  function renderNote(target: HTMLElement, note: LeafNoteMatch, label: string): void {
    const item = reportElement(target, 'div', '', 'leaf-note');
    item.dataset['record'] = note.notePath;
    reportElement(item, 'p', `${label}: ${note.notePath}`);
    reportElement(item, 'p', noteIdentityLabel(note.status), 'leaf-context');
    if (host.openNote) {
      button(item, 'Open note', () => host.openNote?.(note.notePath));
    }
    button(item, 'Copy note path', () => host.copy(note.absolutePath));
  }
  function renderRelationship(target: HTMLElement): void {
    const binding = node.evidence?.bindingNote;
    if (binding) {
      reportElement(target, 'h3', 'This folder’s binding');
      reportElement(target, 'p', `Associated note: ${binding}`);
      if (host.openNote) {
        button(target, 'Open associated note', () => host.openNote?.(binding));
      }
      if (node.evidence?.status === 'Bound at different path') {
        pathField(target, 'Actual folder', node.folderPath);
        pathField(target, 'Expected folder', node.evidence.expectedFolder ?? '');
      }
    }
    const ancestors = markedAncestors(index, node);
    const nearest = ancestors.next().value as LeafTreeNode | undefined;
    if (nearest) {
      renderAncestor(target, nearest);
      const others = [...ancestors];
      if (others.length) {
        const otherAncestors = section(target, `Other marked ancestors (${String(others.length)}) — overlapping marker evidence`, 'ancestors');
        paged(otherAncestors, others, (ancestor) => {
          renderAncestor(otherAncestors, ancestor);
        });
      }
    }
    for (const folder of node.evidence?.relatedFolders ?? []) {
      if (folder !== node.folderPath) {
        pathField(target, 'Matching UUID folder', folder);
      }
    }
  }
  function renderAncestor(target: HTMLElement, ancestor: LeafTreeNode): void {
    const card = reportElement(target, 'div', '', 'leaf-relationship');
    card.dataset['record'] = ancestor.id;
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
  function renderActions(target: HTMLElement): void {
    if (isRoot || node.kind === 'virtual') {
      return;
    }
    const stale = !!model.stale;
    const pending = options.overlay?.[1] === null;
    const blocked = stale || !options.availability?.adoptable;
    if (host.adopt) {
      const adopt = button(target, 'Adopt this folder…', () => host.adopt?.(node.folderPath));
      adopt.disabled = options.busy || blocked;
      adopt.dataset['adoptionBlocked'] = String(blocked);
      if (node.conflict) {
        reportElement(target, 'p', 'Adoption is blocked by conflicting or invalid identity evidence. Inspect the associated notes and markers below.');
      }
      if (!blocked) {
        reportElement(target, 'p', 'Choose a note to check adoption. Preview checks depend on the selected note and mode.');
      }
    }
    if (pending) {
      reportElement(target, 'p', `An unfinished operation affects ${options.overlay?.[0] ?? node.folderPath}. Inspect or resume it before continuing.`);
      if (host.resume) {
        button(target, 'Review pending operation', host.resume);
      }
    } else if (stale || options.overlay) {
      reportElement(target, 'p', 'This snapshot predates a binding change. Refresh to check current evidence and available actions.');
      if (host.refresh) {
        button(target, 'Refresh status', host.refresh);
      }
    }
    const blockers = reportElement(target, 'div', '', 'leaf-blockers');
    runAuditSteps(adoptionBlockerSteps(index, node), { signal: options.signal }).then((items) => {
      if (options.signal.aborted) {
        return;
      }
      if (items.length) {
        reportElement(blockers, 'p', `${String(items.length)} known adoption ${items.length === 1 ? 'restriction' : 'restrictions'}:`);
      }
      paged(blockers, items, (item) => {
        const entry = reportElement(blockers, 'div');
        entry.dataset['record'] = `${item.location}:${item.message}`;
        reportElement(entry, 'p', `${item.message}\n${item.location}`, 'leaf-context');
        const affected = index.nodes.get(item.nodeId ?? '');
        if (affected && affected.id !== node.id) {
          button(entry, 'Inspect affected folder', () => options.select(affected));
        }
      });
      options.onSettled();
    }).catch((error: unknown) => {
      if (!options.signal.aborted) {
        options.onError(error instanceof Error ? error.message : 'Could not inspect restrictions.');
      }
    });
    renderRepairActions(stale, target);
  }
  function renderRepairActions(stale: boolean, target: HTMLElement): void {
    if (host.repair && node.evidence?.status === 'Bound at different path' && node.evidence.confidence === 'checked') {
      for (const direction of ['external', 'note'] as const) {
        const label = direction === 'external' ? 'Move external folder to match note…' : 'Move note to match external folder…';
        const repair = button(target, label, () => host.repair?.(node.folderPath, direction));
        repair.disabled = options.busy || stale || !!options.overlay;
        repair.dataset['adoptionBlocked'] = String(stale || !!options.overlay);
        reportElement(
          target,
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
