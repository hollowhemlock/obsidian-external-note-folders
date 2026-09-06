import {
  describe,
  expect,
  it
} from 'vitest';

import {
  formatCopyableReport,
  formatReportContext
} from './modalReport.ts';

describe('modal report context', () => {
  it('formats absolute vault and external-root paths in the required order', () => {
    expect(formatReportContext({
      externalRootPath: 'X:\\External',
      vaultPath: 'X:\\Vault'
    })).toBe([
      'vault-path:',
      'X:\\Vault',
      'external-root:',
      'X:\\External'
    ].join('\n'));
  });

  it('prepends the path context to copied report text', () => {
    expect(formatCopyableReport({
      externalRootPath: 'X:\\External',
      vaultPath: 'X:\\Vault'
    }, '# Report')).toBe([
      'vault-path:',
      'X:\\Vault',
      'external-root:',
      'X:\\External',
      '',
      '# Report'
    ].join('\n'));
  });
});
