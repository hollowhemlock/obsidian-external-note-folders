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

describe('drift report semantic fixtures', () => {
  it('classifies the basic drift matrix from committed fixtures', async () => {
    const scenario = await prepareSemanticScenario({
      domain: 'drift-report',
      scenario: 'basic-drift-matrix'
    });
    const expected = await readExpectedDriftReport({
      domain: 'drift-report',
      expectedPath: scenario.expectedPath,
      scenario: 'basic-drift-matrix'
    });
    const vaultScan = await scanFixtureVault({
      relativeScenarioPath: 'drift-report/basic-drift-matrix',
      vaultRootPath: scenario.semanticVaultPath
    });
    const externalScan = await scanExternalRoot(scenario.semanticExternalRootPath);

    const report = buildDriftReport(vaultScan, externalScan);

    expectDriftReportToMatchExpected({
      actual: report,
      expected,
      externalRootPath: externalScan.rootPath
    });
  });
});
