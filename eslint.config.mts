import type { Linter } from 'eslint';

import { obsidianDevUtilsConfigs } from 'obsidian-dev-utils/ScriptUtils/ESLint/eslint.config';

const configs: Linter.Config[] = [
  ...obsidianDevUtilsConfigs,
  {
    ignores: ['test/fixtures/**', 'test/integration/**']
  },
  {
    rules: {
      // The upstream import resolver currently reports a resolver-interface error on every file.
      'import/no-extraneous-dependencies': 'off'
    }
  },
  {
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
      'no-magic-numbers': 'off',
      'obsidianmd/hardcoded-config-path': 'off',
      'prefer-named-capture-group': 'off'
    }
  },
  {
    files: [
      'src/core/pathPolicy.ts',
      'src/core/uuid.ts',
      'src/PluginSettingsTab.ts',
      'src/storage/**',
      'src/**/*.test.ts',
      'test/**/*.ts'
    ],
    rules: {
      // External-root support is intentionally implemented with raw Node filesystem APIs.
      'import-x/no-nodejs-modules': 'off',
      'no-control-regex': 'off'
    }
  },
  {
    files: ['src/Plugin.ts'],
    rules: {
      'obsidianmd/ui/sentence-case': 'off'
    }
  },
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
