import type { LeafNoteMatch } from './leafQuery.ts';

export type EvidenceState = 'absent' | 'invalid' | 'present' | 'unchecked';
export interface FolderEvidence {
  bindingNote?: string;
  candidates: LeafNoteMatch[];
  confidence: 'checked' | 'provisional';
  descendants?: { boundFolders: number; markedFolders: number };
  exact: EvidenceState;
  expectedFolder?: string;
  explanations: string[];
  marker: EvidenceState;
  physicalLeaf: boolean;
  relatedFolders: string[];
  status: string;
  uuid?: string;
  yaml: EvidenceState;
}
