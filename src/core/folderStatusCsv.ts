import type { AuditTable } from './auditCsv.ts';
import type { LeafTreeNode } from './leafTree.ts';

export function folderStatusTable(nodes: readonly LeafTreeNode[]): AuditTable {
  return {
    columns: ['folderPath', 'relativePath', 'kind', 'exact', 'yaml', 'marker', 'status', 'confidence', 'notePaths', 'relatedFolders', 'explanation'],
    rows: nodes.map((node) => ({
      confidence: node.evidence?.confidence ?? 'provisional',
      exact: node.evidence?.exact ?? 'unchecked',
      explanation: node.evidence?.explanations.join('\n') ?? '',
      folderPath: node.folderPath,
      kind: node.kind,
      marker: node.evidence?.marker ?? 'unchecked',
      notePaths: node.notes.map((note) => note.notePath).join('\n'),
      relatedFolders: node.evidence?.relatedFolders.join('\n') ?? '',
      relativePath: node.relativePath,
      status: node.evidence?.status ?? 'Unchecked',
      yaml: node.evidence?.yaml ?? 'unchecked'
    }))
  };
}
