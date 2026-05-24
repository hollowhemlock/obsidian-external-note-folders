import { readFile } from 'node:fs/promises';

import { isCanonicalUuid } from '../../../src/core/uuid.ts';

export interface ExpectedDriftBindingRow {
  actualExternalFolderPath: null | string;
  expectedExternalFolderPath: null | string;
  notePath: null | string;
  uuid: string;
}

export interface ExpectedDriftOccupiedRow {
  expectedExternalFolderPath: string;
  notePath: string;
  reason: string;
  uuid: string;
}

export interface ExpectedDriftReport {
  domain: 'drift-report';
  errors: string[];
  externalRootIgnorePatterns?: string[];
  ignoredRows: ExpectedDriftBindingRow[];
  missingRows: ExpectedDriftBindingRow[];
  occupiedRows: ExpectedDriftOccupiedRow[];
  orphanRows: ExpectedDriftBindingRow[];
  scenario: string;
  schemaVersion: 1;
  suggestions: ExpectedDriftSuggestion[];
  summary: ExpectedDriftSummary;
  unexpectedRows: ExpectedDriftBindingRow[];
  warnings: string[];
}

export interface ExpectedDriftSuggestion {
  candidateExternalFolderPath: string;
  confidence: 'high' | 'low' | 'medium';
  expectedExternalFolderPath: string;
  notePath: string;
  rationale: string;
  uuid: string;
}

export interface ExpectedDriftSummary {
  errors: number;
  ignoredUnchecked: number;
  missingExpectedFolders: number;
  occupiedTargetPaths: number;
  orphanFolders: number;
  suggestions: number;
  unexpectedPaths: number;
  warnings: number;
}

const DRIFT_ALLOWED_KEYS = new Set([
  'domain',
  'errors',
  'externalRootIgnorePatterns',
  'ignoredRows',
  'missingRows',
  'occupiedRows',
  'orphanRows',
  'scenario',
  'schemaVersion',
  'suggestions',
  'summary',
  'unexpectedRows',
  'warnings'
]);

const SUMMARY_ALLOWED_KEYS = new Set([
  'errors',
  'ignoredUnchecked',
  'missingExpectedFolders',
  'occupiedTargetPaths',
  'orphanFolders',
  'suggestions',
  'unexpectedPaths',
  'warnings'
]);

export async function readExpectedDriftReport(input: {
  domain: 'drift-report';
  expectedPath: string;
  scenario: string;
}): Promise<ExpectedDriftReport> {
  const parsed = JSON.parse(await readFile(input.expectedPath, 'utf8')) as unknown;
  assertExpectedDriftReport(parsed, input);
  return parsed;
}

function assertAllowedKeys(input: Record<string, unknown>, allowedKeys: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label} has unknown key: ${key}`);
    }
  }
}

function assertArray(input: unknown, label: string): asserts input is unknown[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array.`);
  }
}

function assertExpectedDriftReport(
  input: unknown,
  context: { domain: 'drift-report'; expectedPath: string; scenario: string }
): asserts input is ExpectedDriftReport {
  if (!isRecord(input)) {
    throw new Error(`${context.expectedPath} must contain an object.`);
  }

  assertAllowedKeys(input, DRIFT_ALLOWED_KEYS, context.expectedPath);
  if (input['schemaVersion'] !== 1) {
    throw new Error(`${context.expectedPath} must use schemaVersion 1.`);
  }

  if (input['domain'] !== context.domain) {
    throw new Error(`${context.expectedPath} domain must be ${context.domain}.`);
  }

  if (input['scenario'] !== context.scenario) {
    throw new Error(`${context.expectedPath} scenario must be ${context.scenario}.`);
  }

  assertDriftSummary(input['summary'], context.expectedPath);
  for (const key of ['errors', 'warnings']) {
    assertStringArray(input[key], `${context.expectedPath}.${key}`);
  }

  if (Object.hasOwn(input, 'externalRootIgnorePatterns')) {
    assertStringArray(input.externalRootIgnorePatterns, `${context.expectedPath}.externalRootIgnorePatterns`);
  }

  for (const key of ['ignoredRows', 'missingRows', 'orphanRows', 'unexpectedRows']) {
    assertArray(input[key], `${context.expectedPath}.${key}`);
    for (const row of input[key]) {
      assertDriftBindingRow(row, `${context.expectedPath}.${key}`);
    }
  }

  assertArray(input['occupiedRows'], `${context.expectedPath}.occupiedRows`);
  for (const row of input['occupiedRows']) {
    assertDriftOccupiedRow(row, `${context.expectedPath}.occupiedRows`);
  }

  assertArray(input['suggestions'], `${context.expectedPath}.suggestions`);
  for (const row of input['suggestions']) {
    assertDriftSuggestion(row, `${context.expectedPath}.suggestions`);
  }

  assertSummaryMatchesRows(input as unknown as ExpectedDriftReport, context.expectedPath);
  assertNoDuplicateRows(input as unknown as ExpectedDriftReport, context.expectedPath);
}

function assertDriftBindingRow(input: unknown, label: string): asserts input is ExpectedDriftBindingRow {
  assertRecordKeys(input, new Set(['actualExternalFolderPath', 'expectedExternalFolderPath', 'notePath', 'uuid']), label);
  assertNullableRelativePath(input['actualExternalFolderPath'], `${label}.actualExternalFolderPath`);
  assertNullableRelativePath(input['expectedExternalFolderPath'], `${label}.expectedExternalFolderPath`);
  assertNullableRelativePath(input['notePath'], `${label}.notePath`);
  assertUuid(input['uuid'], `${label}.uuid`);
}

function assertDriftOccupiedRow(input: unknown, label: string): asserts input is ExpectedDriftOccupiedRow {
  assertRecordKeys(input, new Set(['expectedExternalFolderPath', 'notePath', 'reason', 'uuid']), label);
  assertRelativePath(input['expectedExternalFolderPath'], `${label}.expectedExternalFolderPath`);
  assertRelativePath(input['notePath'], `${label}.notePath`);
  assertString(input['reason'], `${label}.reason`);
  assertUuid(input['uuid'], `${label}.uuid`);
}

function assertDriftSuggestion(input: unknown, label: string): asserts input is ExpectedDriftSuggestion {
  assertRecordKeys(input, new Set(['candidateExternalFolderPath', 'confidence', 'expectedExternalFolderPath', 'notePath', 'rationale', 'uuid']), label);
  assertRelativePath(input['candidateExternalFolderPath'], `${label}.candidateExternalFolderPath`);
  assertRelativePath(input['expectedExternalFolderPath'], `${label}.expectedExternalFolderPath`);
  assertRelativePath(input['notePath'], `${label}.notePath`);
  if (!['high', 'low', 'medium'].includes(String(input['confidence']))) {
    throw new Error(`${label}.confidence must be high, low, or medium.`);
  }
  assertString(input['rationale'], `${label}.rationale`);
  assertUuid(input['uuid'], `${label}.uuid`);
}

function assertDriftSummary(input: unknown, label: string): asserts input is ExpectedDriftSummary {
  assertRecordKeys(input, SUMMARY_ALLOWED_KEYS, `${label}.summary`);
  for (const key of SUMMARY_ALLOWED_KEYS) {
    if (!Number.isInteger(input[key]) || Number(input[key]) < 0) {
      throw new Error(`${label}.summary.${key} must be a non-negative integer.`);
    }
  }
}

function assertNoAbsoluteOrBackslashPath(input: string, label: string): void {
  if (input.includes('\\')) {
    throw new Error(`${label} must use slash-normalized paths.`);
  }

  if (
    input.startsWith('/')
    || /^[A-Za-z]:\//u.test(input)
    || input.startsWith('//')
  ) {
    throw new Error(`${label} must be relative.`);
  }
}

function assertNoDuplicateRows(report: ExpectedDriftReport, label: string): void {
  assertUnique(report.unexpectedRows.map((row) => `${toRowKeyPart(row.notePath)}\0${row.uuid}`), `${label}.unexpectedRows`);
  assertUnique(report.ignoredRows.map((row) => `${toRowKeyPart(row.notePath)}\0${row.uuid}`), `${label}.ignoredRows`);
  assertUnique(report.missingRows.map((row) => `${toRowKeyPart(row.notePath)}\0${row.uuid}`), `${label}.missingRows`);
  assertUnique(report.orphanRows.map((row) => `${toRowKeyPart(row.actualExternalFolderPath)}\0${row.uuid}`), `${label}.orphanRows`);
  assertUnique(report.occupiedRows.map((row) => `${row.notePath}\0${row.expectedExternalFolderPath}\0${row.uuid}`), `${label}.occupiedRows`);
  assertUnique(report.suggestions.map((row) => `${row.notePath}\0${row.candidateExternalFolderPath}\0${row.uuid}`), `${label}.suggestions`);
  assertUnique(report.errors, `${label}.errors`);
  assertUnique(report.warnings, `${label}.warnings`);
}

function assertNullableRelativePath(input: unknown, label: string): void {
  if (input === null) {
    return;
  }

  assertRelativePath(input, label);
}

function assertRecordKeys(input: unknown, allowedKeys: ReadonlySet<string>, label: string): asserts input is Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object.`);
  }

  assertAllowedKeys(input, allowedKeys, label);
  for (const key of allowedKeys) {
    if (!Object.hasOwn(input, key)) {
      throw new Error(`${label} is missing required key: ${key}`);
    }
  }
}

function assertRelativePath(input: unknown, label: string): asserts input is string {
  assertString(input, label);
  assertNoAbsoluteOrBackslashPath(input, label);
}

function assertString(input: unknown, label: string): asserts input is string {
  if (typeof input !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
}

function assertStringArray(input: unknown, label: string): asserts input is string[] {
  assertArray(input, label);
  for (const item of input) {
    assertString(item, label);
    assertNoAbsoluteOrBackslashPath(item, label);
  }
}

function assertSummaryMatchesRows(report: ExpectedDriftReport, label: string): void {
  const expectations: Record<keyof ExpectedDriftSummary, number> = {
    errors: report.errors.length,
    ignoredUnchecked: report.ignoredRows.length,
    missingExpectedFolders: report.missingRows.length,
    occupiedTargetPaths: report.occupiedRows.length,
    orphanFolders: report.orphanRows.length,
    suggestions: report.suggestions.length,
    unexpectedPaths: report.unexpectedRows.length,
    warnings: report.warnings.length
  };
  for (const [key, expectedCount] of Object.entries(expectations)) {
    if (report.summary[key as keyof ExpectedDriftSummary] !== expectedCount) {
      throw new Error(`${label}.summary.${key} must equal ${String(expectedCount)}.`);
    }
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== values.length) {
    throw new Error(`${label} contains duplicate row identities.`);
  }
}

function assertUuid(input: unknown, label: string): void {
  assertString(input, label);
  if (!isCanonicalUuid(input)) {
    throw new Error(`${label} must be a canonical lowercase UUID.`);
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function toRowKeyPart(input: null | string): string {
  return input ?? '';
}
