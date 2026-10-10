import type { LeafTreeNode } from './leafTree.ts';
/** A preview candidate only; fresh repair checks authorize writes. */
export function missingMarkerNote(node: LeafTreeNode): string | undefined {
  if (
    node.kind !== 'directory' || node.unchecked || node.conflict || node.covered || !node.inspection?.directoryChecked
    || node.markers.length || node.evidence?.marker !== 'absent' || node.notes.length !== 1
  ) {
    return undefined;
  }
  const note = node.notes[0];
  return note?.association === 'exact' && note.status === 'valid' ? note.notePath : undefined;
}
