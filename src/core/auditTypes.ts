import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

export interface AuditIssue {
  code?: 'git-repository-unavailable';
  exclusionSource?: 'git' | 'metadata' | 'settings';
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
  checkedDirectories?: { entries: string[]; path: string }[];
  /** Successful directory enumerations; absence is established only by these entries. */
  confirmedAbsences?: string[];
  external: ExternalScanResult;
  externalRoot: string;
  finishedAt: string;
  folders: string[];
  issues: AuditIssue[];
  markers: AuditMarker[];
  notes: AuditNote[];
  repositoryRoots?: string[];
  startedAt: string;
  statusScanMode?: StatusScanMode;
  templateExclusions?: import('./templateExclusions.ts').TemplateExclusions;
  vault: VaultScanResult;
  vaultRoot: string;
  work?: AuditWorkCounts;
}

export interface AuditWorkCounts {
  directoriesEnumerated: number;
  gitProcesses: number;
  maxConcurrentReads: number;
  notesParsed: number;
  notesRead: number;
}

export type StatusScanMode = 'filtered' | 'unfiltered';
