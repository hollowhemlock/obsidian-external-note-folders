import type { Linter } from 'eslint';

import { obsidianDevUtilsConfigs } from 'obsidian-dev-utils/ScriptUtils/ESLint/eslint.config';

const configs: Linter.Config[] = [
  ...obsidianDevUtilsConfigs,
  { ignores: ['test/fixtures/**'] },
  { files: ['scripts/**'], rules: { 'no-console': 'off' } },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-magic-numbers': 'off'
    }
  }
];

// eslint-disable-next-line import-x/no-default-export -- ESLint infrastructure requires a default export.
export default configs;
