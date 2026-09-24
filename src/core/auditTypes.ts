import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

export interface AuditIssue {
  kind?: 'directory' | 'link' | 'marker' | 'note';
  location: string;
  reason: string;
  scope?: 'external' | 'vault';
  unchecked: boolean;
}

export interface AuditMarker {
  folderPath: string;
  format: string;
  markerPath: string;
  status: string;
  uuid: string;
}

export interface AuditNote {
  hasExnf: boolean;
  notePath: string;
  relativePath: string;
  status: string;
  uuid: string;
  value: string;
}

export type AuditScan = AuditSnapshot;

export interface AuditSnapshot {
  external: ExternalScanResult;
  externalRoot: string;
  finishedAt: string;
  folders: string[];
  issues: AuditIssue[];
  markers: AuditMarker[];
  notes: AuditNote[];
  startedAt: string;
  templateExclusions?: import('./templateExclusions.ts').TemplateExclusions;
  vault: VaultScanResult;
  vaultRoot: string;
}
