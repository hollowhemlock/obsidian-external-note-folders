import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

export interface AuditIssue {
  location: string;
  reason: string;
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
  vault: VaultScanResult;
  vaultRoot: string;
}
