import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildLeafReport } from '../core/leafReport.ts';
import { AuditSession } from './auditSession.ts';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Preserve inferred Vitest mock signatures in this test helper.
function fixture() {
  const snapshot = auditFixture(1);

  const state = { active: false, activity: 0, sequence: 0 };

  const host = {
    actionStatus: vi.fn(),
    analyze: vi.fn(async () => buildLeafReport(snapshot)),
    mutationState: (): { active: boolean; activity: number; sequence: number } => ({ ...state }),
    scan: vi.fn(async () => snapshot),
    scanContext: (): { externalRoot: string; vaultRoot: string } => ({ externalRoot: snapshot.externalRoot, vaultRoot: snapshot.vaultRoot }),
    scanFailure: vi.fn(),
    status: vi.fn(),
    update: vi.fn(async () => {
      await Promise.resolve();
    })
  };

  return { host, session: new AuditSession(host), snapshot, state };
}

describe('audit tab session', () => {
  it('retains first-failure diagnostics during retries and clears them only when an attempt finishes', async () => {
    const { host, session, snapshot } = fixture();
    host.scan.mockRejectedValueOnce(Object.assign(new Error('Git diagnostic\nsecond line'), { root: '/broken/repository' }));
    await session.refresh('unfiltered');
    expect(session.failure).toMatchObject({
      affectedPath: '/broken/repository',
      error: 'Git diagnostic\nsecond line',
      externalRoot: snapshot.externalRoot,
      retainedResults: false,
      statusScanMode: 'unfiltered',
      vaultRoot: snapshot.vaultRoot
    });
    expect(host.scanFailure).toHaveBeenLastCalledWith(session.failure);
    expect(session.snapshot).toBeUndefined();
    expect(host.status).toHaveBeenLastCalledWith('Scan failed. No completed scan. See Scan details.', false);
    const failure = session.failure;
    let finish: (() => void) | undefined;
    host.scan.mockImplementationOnce(() =>
      new Promise((resolve) => {
        finish = (): void => {
          resolve(snapshot);
        };
      })
    );
    const pending = session.refresh();
    expect(session.failure).toBe(failure);
    expect(host.scanFailure).toHaveBeenCalledTimes(1);
    finish?.();
    await pending;
    expect(session.failure).toBeNull();
    expect(host.scanFailure).toHaveBeenLastCalledWith(null);
    expect(session.snapshot).toBe(snapshot);
  });

  it('keeps failures separate from snapshot and export state and treats cancellation as non-error', async () => {
    const { host, session, snapshot } = fixture();
    await session.refresh();
    host.scan.mockRejectedValueOnce('diagnostic without an Error object');
    host.scanContext = (): { externalRoot: string; vaultRoot: string } => ({ externalRoot: '/changed-external', vaultRoot: snapshot.vaultRoot });
    await session.refresh();
    const failure = session.failure;
    expect(failure).toMatchObject({ error: 'diagnostic without an Error object', externalRoot: '/changed-external', retainedResults: true });
    expect(session.snapshot).toBe(snapshot);
    await session.runExport(async () => null);
    expect(session.failure).toBe(failure);
    host.scan.mockImplementationOnce(async () => {
      session.cancel();
      throw new Error('cancelled');
    });
    await session.refresh();
    expect(session.failure).toBeNull();
    expect(session.snapshot).toBe(snapshot);
    expect(host.status).toHaveBeenLastCalledWith('Scan cancelled. Previous results retained.', false);
  });
  it('publishes a new snapshot with repository warnings after a previous completed scan', async () => {
    const { host, session, snapshot } = fixture();
    await session.refresh();
    const next = {
      ...snapshot,
      issues: [{
        code: 'git-repository-unavailable' as const,
        kind: 'directory' as const,
        location: `${snapshot.externalRoot}/broken`,
        reason: 'Skipped repository: invalid metadata',
        scope: 'external' as const,
        unchecked: true
      }]
    };
    host.scan.mockResolvedValueOnce(next);
    await session.refresh();
    expect(session.snapshot).toBe(next);
    expect(host.update).toHaveBeenCalledTimes(2);
    expect(host.status).toHaveBeenLastCalledWith('Scan complete with warnings. See Scan details for skipped repositories.', false);
  });
  it('defaults to filtered scans, preserves successful mode on failure, and discloses an empty first failure', async () => {
    const { host, session, snapshot } = fixture();
    host.scan.mockRejectedValueOnce(new Error('Git filtering failed'));
    await session.refresh();
    expect(host.status).toHaveBeenLastCalledWith(expect.stringContaining('No completed scan.'), false);
    expect(host.scan).toHaveBeenLastCalledWith(expect.objectContaining({ statusScanMode: 'filtered' }));
    snapshot.statusScanMode = 'unfiltered';
    await session.refresh('unfiltered');
    expect(host.scan).toHaveBeenLastCalledWith(expect.objectContaining({ statusScanMode: 'unfiltered' }));
    const previous = session.snapshot;
    host.scan.mockRejectedValueOnce(new Error('Git filtering failed after partial scanning'));
    await session.refresh();
    expect(session.snapshot).toBe(previous);
    expect(session.snapshot?.statusScanMode).toBe('unfiltered');
    expect(host.update).toHaveBeenCalledTimes(1);
  });

  it('retains the completed snapshot on failed, cancelled and unreadable-root refresh', async () => {
    const { host, session, snapshot } = fixture();

    await session.refresh();

    const previous = session.model;

    host.scan.mockRejectedValueOnce(new Error('Scan unavailable'));

    await session.refresh();

    expect(session.model).toBe(previous);

    expect(host.status).toHaveBeenLastCalledWith(expect.stringContaining('Scan failed'), false);

    host.analyze.mockImplementationOnce(async () => {
      session.cancel();

      return buildLeafReport(snapshot);
    });

    await session.refresh();

    expect(session.model).toBe(previous);

    expect(host.update).toHaveBeenCalledTimes(1);

    snapshot.issues.push({ location: snapshot.externalRoot, reason: 'Permission denied', unchecked: true });

    await session.refresh();

    expect(session.model).toBe(previous);

    expect(session.failure?.error).toContain('source root');
    expect(session.failure?.error).toContain('Permission denied');
    expect(session.failure?.affectedPath).toBe(snapshot.externalRoot);
  });

  it('warns when mutation activity overlaps even if the sequence is unchanged', async () => {
    const { host, session, snapshot, state } = fixture();

    host.scan.mockImplementationOnce(async () => {
      state.activity++;

      return snapshot;
    });

    await session.refresh();

    expect(session.model?.mutationWarning).toBe(true);

    await session.refresh();

    expect(session.model?.mutationWarning).toBe(false);

    state.active = true;

    await session.refresh();

    expect(session.model?.mutationWarning).toBe(true);
  });

  it('prevents overlapping work and disposes pending scans without publishing', async () => {
    const { host, session, snapshot } = fixture();

    let finish: (() => void) | undefined;

    host.scan.mockImplementationOnce(() =>
      new Promise((resolve) => {
        finish = (): void => {
          resolve(snapshot);
        };
      })
    );

    const pending = session.refresh();

    await session.refresh();

    expect(host.scan).toHaveBeenCalledTimes(1);

    session.dispose();

    finish?.();

    await pending;

    expect(host.update).not.toHaveBeenCalled();
    expect(host.scanFailure).not.toHaveBeenCalled();

    expect(session.snapshot).toBeUndefined();
  });

  it('exports the captured snapshot and retains it when export is cancelled', async () => {
    const { host, session, snapshot } = fixture();

    await session.refresh();

    await session.runExport(async (captured, model, signal) => {
      expect(captured).toBe(snapshot);

      expect(model).toBe(session.model);

      await session.refresh();

      expect(host.scan).toHaveBeenCalledTimes(1);

      session.cancel();

      expect(signal.aborted).toBe(true);

      return null;
    });

    expect(session.snapshot).toBe(snapshot);

    expect(host.actionStatus).toHaveBeenLastCalledWith('Export cancelled.', false);
    expect(host.status).toHaveBeenLastCalledWith('Scan complete. Results describe the recorded scan time.', false);
  });
});
