import type { LeafTreeNode } from '../core/leafTree.ts';

export type FolderAttention = 'conflict' | 'healthy' | 'neutral' | 'optional' | 'review';
export type FolderChange = 'changed' | 'pending' | undefined;

export const ATTENTION_LABELS: Record<FolderAttention, string> = {
  conflict: '⚠ Conflict / recovery',
  healthy: '✓ Healthy binding',
  neutral: '– Informational',
  optional: '○ Optional action',
  review: '? Review recommended'
};

const STATUS_ATTENTION: Record<string, FolderAttention> = {
  'Ambiguous or invalid evidence': 'conflict',
  'Bound at different path': 'review',
  'Expected path differs; bound elsewhere': 'review',
  'Identity conflict': 'conflict',
  'Marker absent here': 'review',
  'No matching note identity': 'review',
  'Possible adoption candidate': 'optional',
  'Possible name matches': 'optional'
};

/** Tag definitions stay in the legend/tooltips and exports, not the details panel. */
export function detailExplanations(node: LeafTreeNode): string[] {
  return (node.evidence?.explanations ?? node.issues).filter((text) => !/^(?:exact|yaml|marker): /u.test(text));
}

/** Attention describes evidence, independently of whether adoption is enabled. */
export function folderAttention(node: LeafTreeNode, change?: FolderChange): FolderAttention {
  const evidence = node.evidence;
  if (change === 'pending' || node.conflict || evidence?.marker === 'invalid' || evidence?.yaml === 'invalid') {
    return 'conflict';
  }
  if (change === 'changed') {
    return 'review';
  }
  if (node.kind === 'excluded' || node.kind === 'link') {
    return 'neutral';
  }
  if (node.unchecked || evidence?.status === 'Unchecked') {
    return 'review';
  }
  const status = evidence?.status ?? '';
  if (status === 'Bound at expected path') {
    return evidence?.confidence === 'checked' ? 'healthy' : 'review';
  }
  return STATUS_ATTENTION[status] ?? 'neutral';
}
