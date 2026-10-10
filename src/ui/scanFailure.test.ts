import {
  describe,
  expect,
  it
} from 'vitest';

import {
  createScanFailure,
  formatScanFailure
} from './scanFailure.ts';

describe('copyable scan failures', () => {
  it('includes the attempted roots, affected path, time, mode and complete diagnostic', () => {
    const failure = createScanFailure(
      Object.assign(new Error('first line\nsecond line'), { path: '/external/broken' }),
      {
        externalRoot: '/external',
        vaultRoot: '/vault'
      },
      'filtered',
      true
    );
    const text = formatScanFailure(failure);
    for (
      const part of [
        '/external/broken',
        'Vault: /vault',
        'External root: /external',
        failure.failedAt,
        'Scan mode: filtered',
        'first line\nsecond line',
        'Previous completed results retained'
      ]
    ) {
      expect(text).toContain(part);
    }
  });

  it('supports a first failure without roots or an Error object', () => {
    const text = formatScanFailure(createScanFailure('Unknown scan failure', {}, 'unfiltered', false));
    expect(text).toContain('No completed scan.');
    expect(text).toContain('External root: Unavailable');
    expect(text).toContain('Unknown scan failure');
    expect(text).not.toContain('Affected path:');
  });
});
