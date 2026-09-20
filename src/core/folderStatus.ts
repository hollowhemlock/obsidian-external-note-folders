// eslint-disable-next-line import-x/no-nodejs-modules -- Pure path computation follows ADR-0016.
import path from 'node:path';

import type {
  AuditNote,
  AuditSnapshot
} from './auditTypes.ts';
import type { EvidenceState } from './folderStatusTypes.ts';
import type { LeafNoteMatch } from './leafQuery.ts';
import type { LeafTreeNode } from './leafTree.ts';

import { classifyLeafSegments } from './leafQuery.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity as identity
} from './pathPolicy.ts';

/** Enrich physical topology without inferring identity from names. */
export function* folderStatusSteps(scan: AuditSnapshot, tree: LeafTreeNode[]): Generator<void, void> {
  const nodes = new Map(tree.map((node) => [node.id, node]));
  const byUuid = new Map<string, AuditNote[]>();
  const byName = new Map<string, AuditNote[]>();
  const byTarget = new Map<string, AuditNote[]>();
  const markers = new Map<string, typeof scan.markers>();
  const foldersByUuid = new Map<string, string[]>();
  const expected = new Map<string, string>();
  const complete = !scan.issues.some((issue) => issue.unchecked);
  const root = identity(scan.externalRoot);
  const rootUnchecked = scan.external.accessErrors.length > 0;
  const rootMarked = scan.markers.some((marker) => identity(marker.folderPath) === root);
  const excluded = new Set(scan.external.ignoredDirectories.map((folder) => identity(folder.folderPath)));

  function add<T>(map: Map<string, T[]>, key: string, value: T): void {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  }
  function match(note: AuditNote): LeafNoteMatch {
    return {
      absolutePath: note.notePath,
      notePath: note.relativePath,
      status: note.uuid && scan.vault.duplicatePaths.has(note.uuid) ? 'duplicate-uuid' : note.status
    };
  }
  function ensure(folder: string): LeafTreeNode {
    const key = identity(folder);
    const prior = nodes.get(key);
    if (prior) {
      return prior;
    }
    const relativePath = path.relative(scan.externalRoot, folder);
    const segments = relativePath.split(path.sep);
    const parentPath = path.dirname(folder);
    const parent = identity(parentPath) === root ? null : ensure(parentPath);
    const node: LeafTreeNode = {
      blocked: true,
      categories: classifyLeafSegments(segments),
      children: [],
      conflict: false,
      covered: parent ? parent.covered || parent.markers.length > 0 : rootMarked,
      descendantIssues: 0,
      folderPath: folder,
      id: key,
      issues: [],
      kind: 'virtual',
      markers: [],
      notes: [],
      parent: parent?.id ?? null,
      relativePath,
      searchText: relativePath.toLowerCase(),
      segments,
      total: 0,
      unchecked: parent?.unchecked ?? rootUnchecked
    };
    parent?.children.push(key);
    nodes.set(key, node);
    tree.push(node);
    return node;
  }
  for (const note of scan.notes) {
    if (note.uuid) {
      add(byUuid, note.uuid, note);
    }
    add(byName, path.posix.basename(note.relativePath, '.md').toLowerCase(), note);
    try {
      const target = deriveExternalFolderPath(note.relativePath, scan.externalRoot);
      expected.set(note.relativePath, target);
      add(byTarget, identity(target), note);
      if (note.uuid) {
        ensure(target);
      }
    } catch { /* Invalid note paths have no target association. */ }
    yield;
  }
  for (const marker of scan.markers) {
    add(markers, identity(marker.folderPath), marker);
    if (marker.uuid) {
      add(foldersByUuid, marker.uuid, marker.folderPath);
    }
    yield;
  }
  function enrich(node: LeafTreeNode): void {
    if (excluded.has(node.id)) {
      node.kind = 'excluded';
    }
    const exact = byTarget.get(node.id) ?? [];
    const local = markers.get(node.id) ?? [];
    const associated = new Map(exact.map((note) => [note.relativePath, note]));
    for (const marker of local) {
      for (const note of byUuid.get(marker.uuid) ?? []) {
        associated.set(note.relativePath, note);
      }
    }
    const notes = [...associated.values()];
    node.notes = notes.map((note) => {
      const atPath = exact.includes(note);
      const byIdentity = local.some((marker) => !!note.uuid && marker.uuid === note.uuid);
      let association: LeafNoteMatch['association'] = 'uuid';
      if (atPath) {
        association = byIdentity ? 'exact+uuid' : 'exact';
      }
      return { ...match(note), association };
    });
    node.searchText = [node.relativePath, ...notes.map((note) => note.relativePath)].join('\n').toLowerCase();
    const valid = notes.filter((note) => !!note.uuid);
    const relatedFolders = [...new Set(valid.flatMap((note) => foldersByUuid.get(note.uuid) ?? []))];
    const uncheckedMarker = local.some((marker) => marker.status === 'unchecked-marker');
    const invalid = invalidEvidence();
    function invalidEvidence(): boolean {
      return local.some(isInvalidMarker)
        || notes.some((note) => ['duplicate-uuid', 'invalid-property'].includes(match(note).status))
        || local.some((marker) => scan.external.duplicatePaths.has(marker.uuid))
        || (local.length > 1 && !uncheckedMarker) || exact.length > 1 || notes.length > 1;
    }
    const nestedBinding = hasNestedBinding(node.covered, local);
    const conflict = nestedBinding || local.some((marker) => !!marker.uuid && exact.some((note) => !!note.uuid && note.uuid !== marker.uuid));
    const binding = uniqueBinding();
    function uniqueBinding(): AuditNote | undefined {
      return local.length === 1 && local[0]?.uuid && (byUuid.get(local[0].uuid)?.length === 1)
        ? byUuid.get(local[0].uuid)?.[0]
        : undefined;
    }
    const candidates = (byName.get(path.basename(node.folderPath).toLowerCase()) ?? []).filter((note) => !associated.has(note.relativePath)).map(match);
    const classification = classify();
    function classify(): string {
      let status = node.covered ? 'Inside a marked folder' : 'Unassigned folder';
      if (!node.covered) {
        if (candidates.length) {
          status = 'Possible name matches';
        }
        if (exact.length) {
          status = valid.length ? 'Marker absent here' : 'Possible adoption candidate';
        }
        if (local.length) {
          status = 'No matching note identity';
        }
        if (binding) {
          status = identity(expected.get(binding.relativePath) ?? '') === node.id ? 'Bound at expected path' : 'Bound at different path';
        }
      }
      if (node.kind === 'virtual') {
        status = relatedFolders.length ? 'Expected path differs; bound elsewhere' : 'Not present in scanned root';
      }
      if (node.unchecked || notes.some((note) => note.status === 'unchecked-frontmatter')) {
        status = 'Unchecked';
      }
      if (invalid) {
        status = 'Ambiguous or invalid evidence';
      }
      if (conflict) {
        status = 'Identity conflict';
      }
      if (node.kind === 'excluded') {
        status = 'Excluded from scan';
      }
      return status;
    }
    node.conflict = hasConflict(node.conflict, invalid, conflict);
    const physicalLeaf = node.kind === 'directory' && !node.unchecked && !node.children.some((id) => nodes.get(id)?.kind !== 'virtual');
    function markerState(): EvidenceState {
      if (local.some(isInvalidMarker)) {
        return 'invalid';
      }
      if (uncheckedMarker) {
        return 'unchecked';
      }
      if (local.length) {
        return 'present';
      }
      return node.unchecked ? 'unchecked' : 'absent';
    }
    function yamlState(): EvidenceState {
      if (notes.some((note) => note.status === 'unchecked-frontmatter')) {
        return 'unchecked';
      }
      if (notes.some((note) => note.status === 'invalid-property')) {
        return 'invalid';
      }
      return valid.length ? 'present' : 'absent';
    }
    node.evidence = {
      candidates,
      confidence: complete ? 'checked' : 'provisional',
      exact: presence(exact.length > 0, complete),
      explanations: [
        yamlExplanation(notes.length, valid.length),
        ...nestedBindingExplanations(nestedBinding),
        ...node.issues,
        ...(complete ? [] : ['Incomplete coverage: uniqueness and absence are provisional.'])
      ],
      marker: markerState(),
      physicalLeaf,
      relatedFolders,
      status: classification,
      yaml: yamlState(),
      ...(binding && !invalid && !conflict && !node.covered
        ? { bindingNote: binding.relativePath, expectedFolder: expected.get(binding.relativePath) ?? '', uuid: binding.uuid }
        : {})
    };
    node.total = physicalLeaf ? 1 : 0;
    node.descendantIssues = 0;
  }
  for (const node of tree) {
    enrich(node);
    yield;
  }
  const ordered = [...tree].sort((a, b) => b.segments.length - a.segments.length);
  for (const node of ordered) {
    const parent = node.parent ? nodes.get(node.parent) : undefined;
    if (parent) {
      parent.total += node.total;
      parent.descendantIssues += node.descendantIssues + Number(node.issues.length > 0 || node.conflict);
    }
    yield;
  }
}

function hasConflict(existing: boolean, invalid: boolean, conflict: boolean): boolean {
  return existing || invalid || conflict;
}
function hasNestedBinding(covered: boolean, markers: AuditSnapshot['markers']): boolean {
  return covered && markers.some((marker) => marker.status === 'valid');
}
function isInvalidMarker(marker: AuditSnapshot['markers'][number]): boolean {
  return marker.status !== 'valid' && marker.status !== 'unchecked-marker';
}
function nestedBindingExplanations(nested: boolean): string[] {
  return nested ? ['This folder contains a valid marker beneath another marked folder.'] : [];
}

function presence(found: boolean, checked: boolean): EvidenceState {
  if (found) {
    return 'present';
  }
  return checked ? 'absent' : 'unchecked';
}
function yamlExplanation(notes: number, valid: number): string {
  if (!notes) {
    return 'No associated note';
  }
  return valid ? 'Note identity present' : 'YAML exnf not found';
}
