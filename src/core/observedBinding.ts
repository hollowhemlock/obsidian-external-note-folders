import type { LeafTreeNode } from './leafTree.ts';

/** Checked binding evidence is independent of exhaustive discovery and write eligibility. */
export function hasObservedBinding(node: LeafTreeNode): boolean {
  const evidence = node.evidence;
  return node.kind === 'directory' && !node.unchecked && !node.conflict
    && !!evidence?.bindingNote && !!evidence.uuid
    && evidence.marker === 'present' && evidence.yaml === 'present'
    && (evidence.status === 'Bound at expected path' || evidence.status === 'Bound at different path');
}
