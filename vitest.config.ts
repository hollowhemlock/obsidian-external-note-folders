import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: { obsidian: fileURLToPath(new URL('./test/support/obsidian.ts', import.meta.url)) },
    exclude: ['node_modules', 'dist', 'test/fixtures', '**/*.integration.test.ts']
  }
});
