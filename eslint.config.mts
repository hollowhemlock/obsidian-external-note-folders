import type { Linter } from 'eslint';

import { obsidianDevUtilsConfigs } from 'obsidian-dev-utils/ScriptUtils/ESLint/eslint.config';

const configs: Linter.Config[] = [
  ...obsidianDevUtilsConfigs.map(includeTestTypeScriptFiles),
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
  },
  {
    files: ['test/support/**/*.ts'],
    rules: {
      'no-magic-numbers': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-modules': 'off'
    }
  }
];

function includeTestTypeScriptFiles(config: Linter.Config): Linter.Config {
  const files = config.files;
  if (!Array.isArray(files) || !files.includes('src/**/*.ts')) {
    return config;
  }

  return {
    ...config,
    files: [
      ...files,
      'test/semantic/**/*.ts',
      'test/support/**/*.ts'
    ]
  };
}

// eslint-disable-next-line import-x/no-default-export -- ESLint infrastructure requires a default export.
export default configs;
