import { assertPrimaryCheckout } from './sandbox-paths.ts';

try {
  assertPrimaryCheckout('Sandbox runtime commands');
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
