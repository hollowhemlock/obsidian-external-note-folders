import {
  access,
  readFile
} from 'node:fs/promises';
import {
  describe,
  expect,
  it
} from 'vitest';

import { resolveRepoPath } from '../support/fixtures/fixtureScenario.ts';

interface CoverageEntry {
  domain: string;
  expectedPath: string;
  kind: 'semantic-fixture';
  notes: string;
  scenario: string;
  stateIds: string[];
}

interface CoverageLedger {
  coveredScenarios: CoverageEntry[];
  plannedCoverage: PlannedCoverageEntry[];
  schemaVersion: 1;
}

interface PlannedCoverageEntry {
  reason: string;
  stateIds: string[];
  target: string;
}

const MATRIX_PATH = 'docs/dev/testing/external-folder-state-matrix.md';
const COVERAGE_PATH = 'docs/dev/testing/external-folder-state-coverage.json';
const STATE_ID_PATTERN = /^\| (?<stateId>(?:G|J|R|T|V)\d+) \|/gmu;

describe('external folder state coverage ledger', () => {
  it('accounts for every state in the external folder state matrix', async () => {
    const matrixStateIds = await readMatrixStateIds();
    const ledger = await readCoverageLedger();
    const accountedStateIds = new Set([
      ...ledger.coveredScenarios.flatMap((scenario) => scenario.stateIds),
      ...ledger.plannedCoverage.flatMap((plannedCoverage) => plannedCoverage.stateIds)
    ]);

    expect([...accountedStateIds].filter((stateId) => !matrixStateIds.has(stateId)).sort()).toEqual([]);
    expect([...matrixStateIds].filter((stateId) => !accountedStateIds.has(stateId)).sort()).toEqual([]);
  });

  it('links covered semantic scenarios to committed expected JSON', async () => {
    const ledger = await readCoverageLedger();
    for (const scenario of ledger.coveredScenarios) {
      await access(resolveRepoPath(scenario.expectedPath));
      const expected = await readJson(scenario.expectedPath);
      if (!isRecord(expected)) {
        throw new Error(`${scenario.expectedPath} must contain a JSON object.`);
      }

      expect(expected['domain']).toBe(scenario.domain);
      expect(expected['scenario']).toBe(scenario.scenario);
    }
  });
});

function assertCoverageEntry(input: unknown, label: string): asserts input is CoverageEntry {
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object.`);
  }

  if (input['kind'] !== 'semantic-fixture') {
    throw new Error(`${label}.kind must be semantic-fixture.`);
  }

  for (const key of ['domain', 'expectedPath', 'notes', 'scenario']) {
    if (typeof input[key] !== 'string' || input[key].length === 0) {
      throw new Error(`${label}.${key} must be a non-empty string.`);
    }
  }

  assertStateIdArray(input['stateIds'], `${label}.stateIds`);
}

function assertCoverageLedger(input: unknown): asserts input is CoverageLedger {
  if (!isRecord(input)) {
    throw new Error(`${COVERAGE_PATH} must contain a JSON object.`);
  }

  if (input['schemaVersion'] !== 1) {
    throw new Error(`${COVERAGE_PATH} must use schemaVersion 1.`);
  }

  if (!Array.isArray(input['coveredScenarios'])) {
    throw new Error(`${COVERAGE_PATH}.coveredScenarios must be an array.`);
  }

  if (!Array.isArray(input['plannedCoverage'])) {
    throw new Error(`${COVERAGE_PATH}.plannedCoverage must be an array.`);
  }

  for (const [index, scenario] of input['coveredScenarios'].entries()) {
    assertCoverageEntry(scenario, `${COVERAGE_PATH}.coveredScenarios[${String(index)}]`);
  }

  for (const [index, plannedCoverage] of input['plannedCoverage'].entries()) {
    assertPlannedCoverageEntry(plannedCoverage, `${COVERAGE_PATH}.plannedCoverage[${String(index)}]`);
  }
}

function assertPlannedCoverageEntry(input: unknown, label: string): asserts input is PlannedCoverageEntry {
  if (!isRecord(input)) {
    throw new Error(`${label} must be an object.`);
  }

  for (const key of ['reason', 'target']) {
    if (typeof input[key] !== 'string' || input[key].length === 0) {
      throw new Error(`${label}.${key} must be a non-empty string.`);
    }
  }

  assertStateIdArray(input['stateIds'], `${label}.stateIds`);
}

function assertStateIdArray(input: unknown, label: string): asserts input is string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array.`);
  }

  const stateIds = input.map((stateId) => {
    if (typeof stateId !== 'string' || !/^(?:G|J|R|T|V)\d+$/u.test(stateId)) {
      throw new Error(`${label} must contain only matrix state IDs.`);
    }

    return stateId;
  });
  if (new Set(stateIds).size !== stateIds.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function readCoverageLedger(): Promise<CoverageLedger> {
  const parsed = await readJson(COVERAGE_PATH);
  assertCoverageLedger(parsed);
  return parsed;
}

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(resolveRepoPath(relativePath), 'utf8')) as unknown;
}

async function readMatrixStateIds(): Promise<Set<string>> {
  const matrix = await readFile(resolveRepoPath(MATRIX_PATH), 'utf8');
  return new Set([...matrix.matchAll(STATE_ID_PATTERN)].map((match) => String(match.groups?.['stateId'])));
}
