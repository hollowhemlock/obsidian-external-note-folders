import {
  describe,
  it
} from 'vitest';

import { buildDriftReport } from '../../src/core/driftReport.ts';
import { scanExternalRoot } from '../../src/storage/scanExternalRoot.ts';
import { readExpectedDriftReport } from '../support/fixtures/expectedSchema.ts';
import { prepareSemanticScenario } from '../support/fixtures/fixtureScenario.ts';
import { expectDriftReportToMatchExpected } from '../support/fixtures/semanticAssertions.ts';
import { scanFixtureVault } from '../support/fixtures/vaultFixtureScanner.ts';

const SCENARIOS = [
  'basic-drift-matrix',
  'ignored-bound-folder',
  'identity-conflicts'
] as const;

describe('drift report semantic fixtures', () => {
  it.each(SCENARIOS)('classifies %s from committed fixtures', async (scenarioName) => {
    const scenario = await prepareSemanticScenario({
      domain: 'drift-report',
      scenario: scenarioName
    });
    const expected = await readExpectedDriftReport({
      domain: 'drift-report',
      expectedPath: scenario.expectedPath,
      scenario: scenarioName
    });
    const vaultScan = await scanFixtureVault({
      relativeScenarioPath: `drift-report/${scenarioName}`,
      vaultRootPath: scenario.semanticVaultPath
    });
    const externalScan = await scanExternalRoot(scenario.semanticExternalRootPath, {
      ignorePatterns: expected.externalRootIgnorePatterns ?? []
    });

    const report = buildDriftReport(vaultScan, externalScan);

    expectDriftReportToMatchExpected({
      actual: report,
      expected,
      externalRootPath: externalScan.rootPath
    });
  });
});
