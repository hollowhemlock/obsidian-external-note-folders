import type {
  ExternalScanResult,
  VaultScanResult
} from './verify.ts';

import {
  normalizeDisplayPath,
  toExternalRelativeDisplayPath
} from './displayPath.ts';
import { formatIgnoredDirectoryWarnings } from './externalRootIgnore.ts';
import {
  deriveExternalFolderPath,
  normalizePathForIdentity
} from './pathPolicy.ts';
import {
  buildExternalScanGlobalErrors,
  formatSkippedDirectoryWarnings
} from './scanEvidence.ts';

const REPORT_SAMPLE_LIMIT = 5;
const MARKDOWN_EXTENSION_LENGTH = 3;

export interface MovedFolderAmbiguityGroup {
  folderCount: number;
  folderSamples: string[];
  normalizedName: string;
  noteCount: number;
  noteSamples: string[];
}

export interface MovedFolderSuggestion {
  candidateExternalFolder: string;
  expectedExternalFolder: string;
  normalizedName: string;
  notePath: string;
}

export interface MovedFolderSuggestionGroup {
  groupPath: string;
  sampleSuggestions: MovedFolderSuggestion[];
  suggestionCount: number;
  suggestions: MovedFolderSuggestion[];
}

export interface MovedFolderSuggestionReport {
  ambiguityGroups: MovedFolderAmbiguityGroup[];
  classificationOmitted: boolean;
  errors: string[];
  groups: MovedFolderSuggestionGroup[];
  markdownReport: string;
  notices: string[];
  summary: MovedFolderSuggestionSummary;
  summaryText: string;
  warnings: string[];
}

export interface MovedFolderSuggestionSummary {
  ambiguousNames: number;
  errorCount: number;
  ignoredDirectories: number;
  skippedDirectories: number;
  uniqueSuggestions: number;
  warningCount: number;
}

interface NamedFolder {
  normalizedName: string;
  relativePath: string;
}

interface NamedNote {
  expectedExternalFolder: string;
  normalizedName: string;
  notePath: string;
}

interface TopologyIndex {
  ancestorOrSelfIdentities: ReadonlySet<string>;
  identities: ReadonlySet<string>;
}

export function buildMovedFolderSuggestionReport(input: {
  exactCandidateIdentities: ReadonlySet<string>;
  externalScan: ExternalScanResult;
  notePaths: readonly string[];
  vaultScan: VaultScanResult;
}): MovedFolderSuggestionReport {
  const errors = buildExternalScanGlobalErrors(input.externalScan).sort();
  const warnings = formatSkippedDirectoryWarnings(input.externalScan).sort();
  const notices = buildNotices(input.externalScan);
  const classificationOmitted = errors.length > 0;
  const result = classificationOmitted
    ? { ambiguityGroups: [], groups: [] }
    : buildSuggestionGroups(input);
  const summary: MovedFolderSuggestionSummary = {
    ambiguousNames: result.ambiguityGroups.length,
    errorCount: errors.length,
    ignoredDirectories: input.externalScan.ignoredDirectories.length,
    skippedDirectories: input.externalScan.skippedDirectories.length,
    uniqueSuggestions: result.groups.reduce((total, group) => total + group.suggestionCount, 0),
    warningCount: warnings.length
  };
  const summaryText = buildSummaryText(summary, classificationOmitted);

  return {
    ambiguityGroups: result.ambiguityGroups,
    classificationOmitted,
    errors,
    groups: result.groups,
    markdownReport: buildMarkdownReport({
      ambiguityGroups: result.ambiguityGroups,
      classificationOmitted,
      errors,
      groups: result.groups,
      notices,
      summaryText,
      warnings
    }),
    notices,
    summary,
    summaryText,
    warnings
  };
}

function addToGroup<T>(groups: Map<string, T[]>, key: string, value: T): void {
  const group = groups.get(key) ?? [];
  group.push(value);
  groups.set(key, group);
}

function buildExcludedFolderIdentities(input: {
  exactCandidateIdentities: ReadonlySet<string>;
  externalScan: ExternalScanResult;
  vaultScan: VaultScanResult;
}): Set<string> {
  const identities = new Set(input.exactCandidateIdentities);
  for (const notePath of buildExistingIdentityNotePaths(input.vaultScan)) {
    try {
      identities.add(normalizePathForIdentity(deriveExternalFolderPath(notePath, input.externalScan.rootPath)));
    } catch {
      // Invalid derived paths cannot reserve external topology.
    }
  }
  for (const folderPath of input.externalScan.bindings.values()) {
    identities.add(normalizePathForIdentity(folderPath));
  }
  for (const folderPaths of input.externalScan.duplicatePaths.values()) {
    for (const folderPath of folderPaths) {
      identities.add(normalizePathForIdentity(folderPath));
    }
  }
  for (const issue of input.externalScan.malformedMarkers) {
    identities.add(normalizePathForIdentity(getParentPath(issue.location)));
  }
  for (const issue of input.externalScan.skippedDirectories) {
    identities.add(normalizePathForIdentity(issue.location));
  }
  for (const ignoredDirectory of input.externalScan.ignoredDirectories) {
    identities.add(normalizePathForIdentity(ignoredDirectory.folderPath));
  }
  return identities;
}

function buildExistingIdentityNotePaths(vaultScan: VaultScanResult): Set<string> {
  const paths = new Set(vaultScan.bindings.values());
  for (const duplicatePaths of vaultScan.duplicatePaths.values()) {
    for (const notePath of duplicatePaths) {
      paths.add(notePath);
    }
  }
  return paths;
}

function buildMarkdownReport(input: {
  ambiguityGroups: readonly MovedFolderAmbiguityGroup[];
  classificationOmitted: boolean;
  errors: readonly string[];
  groups: readonly MovedFolderSuggestionGroup[];
  notices: readonly string[];
  summaryText: string;
  warnings: readonly string[];
}): string {
  return [
    '# Moved External Folder Suggestions',
    '',
    input.summaryText,
    '',
    'This report is read-only. It compares literal note and folder names only; it does not assign UUIDs, write markers, move folders, or adopt candidates.',
    '',
    'Matches are unique only among checked eligible paths. Ignored and skipped subtrees may contain unseen conflicts.',
    '',
    formatList('Errors', input.errors),
    formatList('Warnings', input.warnings),
    formatList('Notices', input.notices),
    input.classificationOmitted
      ? '## Suggestions\n\nUnavailable because the external-root scan or ignore configuration failed.'
      : formatSuggestionGroups(input.groups),
    formatAmbiguityGroups(input.ambiguityGroups),
    '## Safe Adoption Workflow',
    '',
    'To bind a suggested pair safely today, temporarily restore the note to the folder\'s matching relative path, run **Adopt exact-path external folders**, then move the note to its intended path and run **Reconcile external folders**.'
  ].join('\n');
}

function buildNotices(externalScan: ExternalScanResult): string[] {
  return formatIgnoredDirectoryWarnings(externalScan.ignoredDirectories)
    .map((notice) => `${notice}. Ignored paths are unchecked and excluded from moved-folder matching.`);
}

function buildSuggestionGroups(input: {
  exactCandidateIdentities: ReadonlySet<string>;
  externalScan: ExternalScanResult;
  notePaths: readonly string[];
  vaultScan: VaultScanResult;
}): Pick<MovedFolderSuggestionReport, 'ambiguityGroups' | 'groups'> {
  const excludedNotePaths = buildExistingIdentityNotePaths(input.vaultScan);
  const invalidNotePaths = new Set(input.vaultScan.invalidFrontmatter.map((issue) => issue.location));
  const excludedTopology = buildTopologyIndex(buildExcludedFolderIdentities(input));
  const notesByName = new Map<string, NamedNote[]>();
  const foldersByName = new Map<string, NamedFolder[]>();

  for (const notePath of input.notePaths) {
    if (excludedNotePaths.has(notePath) || invalidNotePaths.has(notePath)) {
      continue;
    }

    let expectedFolderPath: string;
    try {
      expectedFolderPath = deriveExternalFolderPath(notePath, input.externalScan.rootPath);
    } catch {
      continue;
    }
    if (input.exactCandidateIdentities.has(normalizePathForIdentity(expectedFolderPath))) {
      continue;
    }

    const name = getNoteBaseName(notePath);
    const normalizedName = normalizeMatchName(name);
    addToGroup(notesByName, normalizedName, {
      expectedExternalFolder: toExternalRelativeDisplayPath(input.externalScan.rootPath, expectedFolderPath),
      normalizedName,
      notePath
    });
  }

  for (const folderPath of input.externalScan.directories) {
    const identity = normalizePathForIdentity(folderPath);
    if (isRelatedToTopology(identity, excludedTopology)) {
      continue;
    }

    const name = getPathBaseName(folderPath).normalize('NFC');
    const normalizedName = normalizeMatchName(name);
    addToGroup(foldersByName, normalizedName, {
      normalizedName,
      relativePath: toExternalRelativeDisplayPath(input.externalScan.rootPath, folderPath)
    });
  }

  const suggestions: MovedFolderSuggestion[] = [];
  const ambiguityGroups: MovedFolderAmbiguityGroup[] = [];
  const names = [...new Set([...notesByName.keys(), ...foldersByName.keys()])].sort();
  for (const normalizedName of names) {
    const notes = [...(notesByName.get(normalizedName) ?? [])].sort((left, right) => left.notePath.localeCompare(right.notePath));
    const folders = [...(foldersByName.get(normalizedName) ?? [])].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    if (notes.length === 0 || folders.length === 0) {
      continue;
    }

    if (notes.length === 1 && folders.length === 1) {
      const note = notes[0];
      const folder = folders[0];
      if (!note || !folder || normalizePathForIdentity(note.expectedExternalFolder) === normalizePathForIdentity(folder.relativePath)) {
        continue;
      }
      suggestions.push({
        candidateExternalFolder: folder.relativePath,
        expectedExternalFolder: note.expectedExternalFolder,
        normalizedName,
        notePath: note.notePath
      });
      continue;
    }

    ambiguityGroups.push({
      folderCount: folders.length,
      folderSamples: folders.slice(0, REPORT_SAMPLE_LIMIT).map((folder) => folder.relativePath),
      normalizedName,
      noteCount: notes.length,
      noteSamples: notes.slice(0, REPORT_SAMPLE_LIMIT).map((note) => note.notePath)
    });
  }

  return {
    ambiguityGroups,
    groups: groupSuggestions(suggestions)
  };
}

function buildSummaryText(summary: MovedFolderSuggestionSummary, classificationOmitted: boolean): string {
  const classification = classificationOmitted
    ? 'suggestion classification unavailable'
    : `${String(summary.uniqueSuggestions)} unique suggestion(s), ${String(summary.ambiguousNames)} ambiguous name(s)`;
  return [
    `${String(summary.errorCount)} error(s)`,
    `${String(summary.warningCount)} warning group(s)`,
    `${String(summary.ignoredDirectories)} ignored external director${summary.ignoredDirectories === 1 ? 'y' : 'ies'}`,
    `${String(summary.skippedDirectories)} skipped external director${summary.skippedDirectories === 1 ? 'y' : 'ies'}`,
    classification
  ].join(', ');
}

function buildTopologyIndex(identities: ReadonlySet<string>): TopologyIndex {
  const normalizedIdentities = new Set([...identities].map(normalizeDisplayPath));
  const ancestorOrSelfIdentities = new Set<string>();
  for (const identity of normalizedIdentities) {
    for (const ancestor of getAncestorOrSelfIdentities(identity)) {
      ancestorOrSelfIdentities.add(ancestor);
    }
  }
  return { ancestorOrSelfIdentities, identities: normalizedIdentities };
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatAmbiguityGroups(groups: readonly MovedFolderAmbiguityGroup[]): string {
  if (groups.length === 0) {
    return '## Ambiguous Names\n\nNone.';
  }
  return [
    '## Ambiguous Names',
    '',
    '| Name | Notes | Folders | Note samples | Folder samples |',
    '| --- | ---: | ---: | --- | --- |',
    ...groups.map((group) =>
      `| ${escapeCell(group.normalizedName)} | ${String(group.noteCount)} | ${String(group.folderCount)} | ${escapeCell(group.noteSamples.join('<br>'))} | ${
        escapeCell(group.folderSamples.join('<br>'))
      } |`
    )
  ].join('\n');
}

function formatList(title: string, items: readonly string[]): string {
  return items.length === 0
    ? `## ${title}\n\nNone.`
    : [`## ${title}`, '', ...items.map((item) => `- ${escapeCell(item)}`)].join('\n');
}

function formatSuggestionGroups(groups: readonly MovedFolderSuggestionGroup[]): string {
  if (groups.length === 0) {
    return '## Suggestions\n\nNone.';
  }
  return [
    '## Suggestions',
    '',
    ...groups.flatMap((group) => [
      `### ${group.groupPath} (${String(group.suggestionCount)})`,
      '',
      '| Vault note | Expected folder | Equivalently named folder |',
      '| --- | --- | --- |',
      ...group.sampleSuggestions.map((suggestion) =>
        `| ${escapeCell(suggestion.notePath)} | ${escapeCell(suggestion.expectedExternalFolder)} | ${escapeCell(suggestion.candidateExternalFolder)} |`
      ),
      ...(group.suggestionCount > group.sampleSuggestions.length
        ? ['', `${String(group.suggestionCount - group.sampleSuggestions.length)} more omitted.`]
        : []),
      ''
    ])
  ].join('\n');
}

function getAncestorOrSelfIdentities(identity: string): string[] {
  const identities: string[] = [];
  let current = normalizeDisplayPath(identity);
  while (current.length > 0) {
    identities.push(current);
    const separator = current.lastIndexOf('/');
    if (separator === -1) {
      break;
    }
    current = current.slice(0, separator);
  }
  return identities;
}

function getNoteBaseName(notePath: string): string {
  const normalized = normalizeDisplayPath(notePath).normalize('NFC');
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  return fileName.endsWith('.md') ? fileName.slice(0, -MARKDOWN_EXTENSION_LENGTH) : fileName;
}

function getParentPath(inputPath: string): string {
  const normalized = normalizeDisplayPath(inputPath);
  const separator = normalized.lastIndexOf('/');
  return separator === -1 ? '' : normalized.slice(0, separator);
}

function getPathBaseName(inputPath: string): string {
  const normalized = normalizeDisplayPath(inputPath).replace(/\/+$/u, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function groupSuggestions(suggestions: readonly MovedFolderSuggestion[]): MovedFolderSuggestionGroup[] {
  const grouped = new Map<string, MovedFolderSuggestion[]>();
  for (const suggestion of suggestions) {
    const normalizedPath = normalizeDisplayPath(suggestion.notePath);
    const separator = normalizedPath.indexOf('/');
    const groupPath = separator === -1 ? '(vault root)' : normalizedPath.slice(0, separator);
    addToGroup(grouped, groupPath, suggestion);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([groupPath, suggestionRows]) => {
      const sorted = [...suggestionRows].sort((left, right) => left.notePath.localeCompare(right.notePath));
      return {
        groupPath,
        sampleSuggestions: sorted.slice(0, REPORT_SAMPLE_LIMIT),
        suggestionCount: sorted.length,
        suggestions: sorted
      };
    });
}

function isRelatedToTopology(identity: string, topology: TopologyIndex): boolean {
  const normalized = normalizeDisplayPath(identity);
  if (topology.ancestorOrSelfIdentities.has(normalized)) {
    return true;
  }
  return getAncestorOrSelfIdentities(normalized).some((ancestor) => topology.identities.has(ancestor));
}

function normalizeMatchName(name: string): string {
  return normalizePathForIdentity(name.normalize('NFC'));
}
