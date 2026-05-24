import {
  cp,
  mkdir,
  rm
} from 'node:fs/promises';
import path from 'node:path';

export interface FixtureScenario {
  domain: string;
  expectedPath: string;
  fixtureExternalScenarioPath: string;
  fixtureExternalRootPath: string;
  fixtureVaultPath: string;
  fixtureVaultScenarioPath: string;
  scenario: string;
  semanticExternalRootPath: string;
  semanticRootPath: string;
  semanticVaultPath: string;
}

const FIXTURE_ROOT = 'test/fixtures/fixture';
const SEMANTIC_SANDBOX_ROOT = 'test/fixtures/sandbox/semantic';

export async function prepareSemanticScenario(input: { domain: string; scenario: string }): Promise<FixtureScenario> {
  const scenario = getFixtureScenario(input);
  await rm(scenario.semanticRootPath, { force: true, recursive: true });
  await mkdir(path.join(scenario.semanticVaultPath, scenario.domain), { recursive: true });
  await mkdir(path.join(scenario.semanticExternalRootPath, scenario.domain), { recursive: true });
  await cp(
    scenario.fixtureVaultScenarioPath,
    path.join(scenario.semanticVaultPath, scenario.domain, scenario.scenario),
    { force: true, recursive: true }
  );
  await cp(
    scenario.fixtureExternalScenarioPath,
    path.join(scenario.semanticExternalRootPath, scenario.domain, scenario.scenario),
    { force: true, recursive: true }
  );
  return scenario;
}

export function getFixtureScenario(input: { domain: string; scenario: string }): FixtureScenario {
  const fixtureVaultPath = resolveRepoPath(path.join(FIXTURE_ROOT, 'vault'));
  const fixtureExternalRootPath = resolveRepoPath(path.join(FIXTURE_ROOT, 'external-root'));
  const semanticRootPath = resolveRepoPath(path.join(SEMANTIC_SANDBOX_ROOT, input.domain, input.scenario));
  return {
    domain: input.domain,
    expectedPath: resolveRepoPath(path.join(FIXTURE_ROOT, 'expected', input.domain, `${input.scenario}.json`)),
    fixtureExternalRootPath,
    fixtureExternalScenarioPath: path.join(fixtureExternalRootPath, input.domain, input.scenario),
    fixtureVaultPath,
    fixtureVaultScenarioPath: path.join(fixtureVaultPath, input.domain, input.scenario),
    scenario: input.scenario,
    semanticExternalRootPath: path.join(semanticRootPath, 'external-root'),
    semanticRootPath,
    semanticVaultPath: path.join(semanticRootPath, 'vault')
  };
}

export function resolveRepoPath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}
