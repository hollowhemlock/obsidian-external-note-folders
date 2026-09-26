import { checkBetaSource } from './beta-source.ts';
import {
  githubClient,
  summary
} from './release-github.ts';

summary(await checkBetaSource(githubClient(), process.argv[2] ?? process.cwd(), process.env['BETA_VERSION'] ?? ''));
