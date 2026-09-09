// Decision notes: stage 7 evidence for the PLAN.md section 8 clock row ("device time jumps:
// all due computations are relative to stored ISO timestamps; a backwards jump shows overdue
// chips rather than crashing; no monotonic assumptions"). The whole session runs on the fake
// clock: a recovering patient with one check already overdue is booted, the clock is set an
// hour back, then an hour forward, with a visibility sweep after each jump. Assertions cover
// the state clock, the board sort and urgency, the rendered timer chip, the stored due times
// (unchanged), the single armed timer and the shift statistics window. Fixtures are synthetic.
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { shiftBounds } from '../../../src/domain/stats';
import { templateTaskId } from '../../../src/domain/types';
import { boardRows } from '../../../src/ui/app/select';
import { createSession, type Session } from '../../../src/ui/app/session';
import { PatientRow } from '../../../src/ui/PatientRow';
import { emptyLoad } from '../../../src/ui/app/boot';
import { FIXED_NOW_MS, patientFresh, patientRecovery } from '../../fixtures/synthetic';
import { fakePlatform, fakeRepo, type FakePlatform } from '../app/helpers';

const MIN = 60_000;
const noop = (): void => undefined;

async function bootRecovery(): Promise<{ platform: FakePlatform; session: Session }> {
  const repo = fakeRepo();
  repo.loadResult = { ...emptyLoad(), patients: [patientRecovery(), patientFresh()] };
  const platform = fakePlatform({ repo });
  const session = createSession(platform);
  await session.start();
  return { platform, session };
}

function rowFor(session: Session, id: string) {
  const found = boardRows(session.state.value).find((r) => r.patient.id === id);
  if (found === undefined) {
    throw new Error(`expected a board row for ${id}`);
  }
  return found;
}

function chipText(session: Session): string {
  cleanup();
  const first = rowFor(session, 'p-recovery');
  render(
    <PatientRow
      patient={first.patient}
      now={session.state.value.now}
      currentTaskId={first.currentTaskId}
      urgency={first.urgency}
      nextDue={first.nextDue}
      onCompleteCurrent={noop}
      onOpen={noop}
    />,
  );
  const chip = screen.queryByText(/overdue|in \d\d:\d\d/);
  return chip?.textContent ?? '';
}

afterEach(() => {
  cleanup();
});

describe('device clock jumps', () => {
  it('survives a backwards jump: chips count down again, nothing throws, one timer stays armed', async () => {
    const { platform, session } = await bootRecovery();
    const check1 = templateTaskId('p-recovery', 'check_1');
    const before = boardRows(session.state.value);
    expect(before.map((r) => r.patient.id)).toEqual(['p-recovery', 'p-fresh']);
    expect(before[0]?.urgency).toBe('overdue');
    expect(chipText(session)).toBe('C1 overdue 05:00');
    const storedDue = session.state.value.patients['p-recovery']?.tasks.find(
      (t) => t.id === check1,
    )?.dueAt;

    platform.clock.set(FIXED_NOW_MS - 60 * MIN);
    expect(() => {
      platform.visible();
    }).not.toThrow();
    expect(session.state.value.now).toBe(FIXED_NOW_MS - 60 * MIN);
    expect(rowFor(session, 'p-recovery').urgency).toBe('intake');
    expect(chipText(session)).toBe('C1 in 55:00');
    expect(
      session.state.value.patients['p-recovery']?.tasks.find((t) => t.id === check1)?.dueAt,
    ).toBe(storedDue);
    expect(platform.clock.pending()).toBe(1);

    platform.clock.advance(50 * MIN);
    expect(rowFor(session, 'p-recovery').urgency).toBe('due_soon');
    expect(chipText(session)).toBe('C1 in 05:00');
    platform.clock.advance(5 * MIN);
    expect(boardRows(session.state.value)[0]?.patient.id).toBe('p-recovery');
    expect(rowFor(session, 'p-recovery').urgency).toBe('overdue');
    expect(platform.clock.pending()).toBe(1);
  });

  it('survives a forward jump: every check is overdue at once and the row sorts first', async () => {
    const { platform, session } = await bootRecovery();
    platform.clock.set(FIXED_NOW_MS + 60 * MIN);
    platform.visible();
    expect(session.state.value.now).toBe(FIXED_NOW_MS + 60 * MIN);
    const rows = boardRows(session.state.value);
    expect(rows[0]?.patient.id).toBe('p-recovery');
    expect(rows[0]?.urgency).toBe('overdue');
    expect(chipText(session)).toBe('C1 overdue 65:00');
    expect(platform.clock.pending()).toBe(1);
    await session.flush();
    expect(platform.repo.calls).toEqual([]);
  });

  it('keeps the shift window and statistics coherent either side of a jump', async () => {
    const { platform, session } = await bootRecovery();
    session.actions.complete('p-recovery', templateTaskId('p-recovery', 'check_1'));
    const stats = session.stats();
    expect(stats.tasksCompleted).toBe(1);

    platform.clock.set(FIXED_NOW_MS - 12 * 60 * MIN);
    platform.visible();
    const earlier = session.stats();
    const bounds = shiftBounds(session.state.value.now);
    expect(bounds.startMs).toBeLessThanOrEqual(session.state.value.now);
    expect(bounds.endMs).toBeGreaterThan(session.state.value.now);
    expect(earlier.tasksCompleted).toBeLessThanOrEqual(1);

    platform.clock.set(FIXED_NOW_MS + MIN);
    platform.visible();
    expect(session.stats()).toEqual(stats);
  });
});
