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
    analyze: vi.fn(async () => buildLeafReport(snapshot)),
    mutationState: (): { active: boolean; activity: number; sequence: number } => ({ ...state }),
    scan: vi.fn(async () => snapshot),
    status: vi.fn(),
    update: vi.fn(async () => {
      await Promise.resolve();
    })
  };

  return { host, session: new AuditSession(host), snapshot, state };
}

describe('audit tab session', () => {
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

    expect(host.status).toHaveBeenLastCalledWith(expect.stringContaining('source root'), false);
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

    expect(host.status).toHaveBeenLastCalledWith('Export cancelled.', false);
  });
});
