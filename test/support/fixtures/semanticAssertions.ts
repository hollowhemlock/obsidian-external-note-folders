import { expect } from 'vitest';

import type { DriftReport } from '../../../src/core/driftReport.ts';
import type {
  ExpectedDriftBindingRow,
  ExpectedDriftOccupiedRow,
  ExpectedDriftReport,
  ExpectedDriftSuggestion
} from './expectedSchema.ts';

export function expectDriftReportToMatchExpected(input: {
  actual: DriftReport;
  expected: ExpectedDriftReport;
  externalRootPath: string;
}): void {
  const actual = normalizeDriftReport(input.actual, input.externalRootPath);
  expect(sortStrings(actual.errors)).toEqual(sortStrings(input.expected.errors));
  expect(sortStrings(actual.warnings)).toEqual(sortStrings(input.expected.warnings));
  expect(sortBindingRows(actual.unexpectedRows)).toEqual(sortBindingRows(input.expected.unexpectedRows));
  expect(sortBindingRows(actual.ignoredRows)).toEqual(sortBindingRows(input.expected.ignoredRows));
  expect(sortBindingRows(actual.missingRows)).toEqual(sortBindingRows(input.expected.missingRows));
  expect(sortBindingRows(actual.orphanRows)).toEqual(sortBindingRows(input.expected.orphanRows));
  expect(sortOccupiedRows(actual.occupiedRows)).toEqual(sortOccupiedRows(input.expected.occupiedRows));
  expect(sortSuggestionRows(actual.suggestions)).toEqual(sortSuggestionRows(input.expected.suggestions));
  expect(input.actual.summaryText).toBe([
    `${String(input.expected.summary.errors)} error(s)`,
    `${String(input.expected.summary.warnings)} warning(s)`,
    `${String(input.expected.summary.unexpectedPaths)} unexpected path(s)`,
    `${String(input.expected.summary.ignoredUnchecked)} ignored/unchecked`,
    `${String(input.expected.summary.missingExpectedFolders)} missing expected folder(s)`,
    `${String(input.expected.summary.orphanFolders)} orphan folder(s)`,
    `${String(input.expected.summary.occupiedTargetPaths)} occupied target(s)`,
    `${String(input.expected.summary.suggestions)} suggestion(s)`
  ].join(', '));
}

interface NormalizedDriftReport {
  errors: string[];
  ignoredRows: ExpectedDriftBindingRow[];
  missingRows: ExpectedDriftBindingRow[];
  occupiedRows: ExpectedDriftOccupiedRow[];
  orphanRows: ExpectedDriftBindingRow[];
  suggestions: ExpectedDriftSuggestion[];
  unexpectedRows: ExpectedDriftBindingRow[];
  warnings: string[];
}

function normalizeDriftReport(report: DriftReport, externalRootPath: string): NormalizedDriftReport {
  return {
    errors: report.errors.map((message) => normalizeMessage(message, externalRootPath)),
    ignoredRows: report.ignoredRows.map(normalizeBindingRow),
    missingRows: report.missingRows.map(normalizeBindingRow),
    occupiedRows: report.occupiedRows.map((row) => ({
      expectedExternalFolderPath: row.expectedExternalFolder,
      notePath: row.notePath,
      reason: row.reason,
      uuid: row.uuid
    })),
    orphanRows: report.orphanRows.map(normalizeBindingRow),
    suggestions: report.suggestions.map((row) => ({
      candidateExternalFolderPath: row.candidateExternalFolder,
      confidence: row.confidence,
      expectedExternalFolderPath: row.expectedExternalFolder,
      notePath: row.notePath,
      rationale: row.rationale,
      uuid: row.uuid
    })),
    unexpectedRows: report.unexpectedRows.map(normalizeBindingRow),
    warnings: report.warnings.map((message) => normalizeMessage(message, externalRootPath))
  };
}

function normalizeBindingRow(row: DriftReport['missingRows'][number]): ExpectedDriftBindingRow {
  return {
    actualExternalFolderPath: row.actualExternalFolder,
    expectedExternalFolderPath: row.expectedExternalFolder,
    notePath: row.notePath,
    uuid: row.uuid
  };
}

function normalizeMessage(message: string, externalRootPath: string): string {
  const normalizedRoot = normalizePath(externalRootPath);
  return normalizePath(message).replaceAll(`${normalizedRoot}/`, '');
}

function normalizePath(input: string): string {
  return input.replaceAll('\\', '/');
}

function sortBindingRows(rows: readonly ExpectedDriftBindingRow[]): ExpectedDriftBindingRow[] {
  return [...rows].sort((left, right) =>
    `${left.notePath ?? ''}\0${left.expectedExternalFolderPath ?? ''}\0${left.actualExternalFolderPath ?? ''}\0${left.uuid}`
      .localeCompare(`${right.notePath ?? ''}\0${right.expectedExternalFolderPath ?? ''}\0${right.actualExternalFolderPath ?? ''}\0${right.uuid}`)
  );
}

function sortOccupiedRows(rows: readonly ExpectedDriftOccupiedRow[]): ExpectedDriftOccupiedRow[] {
  return [...rows].sort((left, right) =>
    `${left.notePath}\0${left.expectedExternalFolderPath}\0${left.uuid}`.localeCompare(
      `${right.notePath}\0${right.expectedExternalFolderPath}\0${right.uuid}`
    )
  );
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

function sortSuggestionRows(rows: readonly ExpectedDriftSuggestion[]): ExpectedDriftSuggestion[] {
  return [...rows].sort((left, right) =>
    `${left.notePath}\0${left.expectedExternalFolderPath}\0${left.candidateExternalFolderPath}\0${left.uuid}`
      .localeCompare(`${right.notePath}\0${right.expectedExternalFolderPath}\0${right.candidateExternalFolderPath}\0${right.uuid}`)
  );
}
