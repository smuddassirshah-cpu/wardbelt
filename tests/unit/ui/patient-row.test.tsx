import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatientRow } from '../../../src/ui/PatientRow';
import { formatClock } from '../../../src/ui/format';
import { templateTaskId } from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  isoPlus,
  patientDischarged,
  patientFresh,
  patientInTheatre,
  patientPreOp,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';
import type { Patient } from '../../../src/domain/types';

function row(patient: Patient) {
  return render(
    <PatientRow
      patient={patient}
      now={FIXED_NOW_MS}
      urgency="none"
      onCompleteCurrent={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
}

afterEach(cleanup);

/**
 * What a timer chip shows: the step's glyph and the countdown. The space before the countdown
 * must be non-breaking, because an ordinary one at the start of a flex item collapses away.
 */
function visibleText(chip: Element | null): string {
  const inFlow = Array.from(chip?.children ?? []).filter(
    (el) => !el.classList.contains('visually-hidden'),
  );
  expect(inFlow).toHaveLength(2);
  const text = inFlow.map((el) => el.textContent).join('');
  expect(text).toContain('\u00a0');
  return text.replace(/\u00a0/g, ' ');
}

/** The label a screen reader reads out for a chip, with the decorative glyph left out. */
function chipLabel(chip: Element | null): string {
  const parts = Array.from(chip?.childNodes ?? [])
    .filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true'))
    .map((n) => n.textContent ?? '');
  return parts.join('').replace(/\u00a0/g, ' ');
}

describe('PatientRow', () => {
  it('shows the header, opens on tap and completes from the current cell', () => {
    const onOpen = vi.fn();
    const onComplete = vi.fn();
    const p = patientFresh();
    render(
      <PatientRow
        patient={p}
        now={FIXED_NOW_MS}
        currentTaskId={templateTaskId('p-fresh', 'handover_admit')}
        urgency="intake"
        onCompleteCurrent={onComplete}
        onOpen={onOpen}
      />,
    );
    const header = screen.getByRole('button', { name: /Fixture Dog One/ });
    expect(header.textContent).toContain('Dog');
    expect(header.textContent).toContain('K1');
    expect(header.textContent).toContain('Lump removal');
    expect(header.textContent).toContain('Intake 08:00');
    expect(header.textContent).toContain('Status Waiting');
    expect(header.querySelector('.chip--accent')).not.toBeNull();
    fireEvent.click(header);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Complete Handover and admit' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders an overdue timer chip in danger from nextDue and now', () => {
    const p = patientRecovery();
    const { container } = render(
      <PatientRow
        patient={p}
        now={FIXED_NOW_MS}
        currentTaskId={templateTaskId('p-recovery', 'check_1')}
        urgency="overdue"
        nextDue={{
          taskId: templateTaskId('p-recovery', 'check_1'),
          dueAt: isoPlus(FIXED_NOW_ISO, -5),
        }}
        onCompleteCurrent={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const chip = container.querySelector('.chip--danger');
    expect(chipLabel(chip)).toBe('Post-op check 1 overdue 05:00');
    expect(chip?.querySelector('svg')?.getAttribute('data-icon')).toBe('check_1');
    expect(chip?.querySelector('.chip__glyph')?.getAttribute('aria-hidden')).toBe('true');
    expect(chip?.classList.contains('mono')).toBe(true);
    expect(visibleText(chip)).toBe('1 overdue 05:00');
    expect(container.querySelector('.row')?.getAttribute('data-urgency')).toBe('overdue');
    expect(container.querySelector('.chip--accent')).toBeNull();
  });

  it('renders a due-soon chip in warning with the custom code', () => {
    const p = patientWithCustomTask();
    const { container } = render(
      <PatientRow
        patient={p}
        now={FIXED_NOW_MS}
        currentTaskId={templateTaskId('p-custom', 'check_1')}
        urgency="due_soon"
        nextDue={{ taskId: 'p-custom:custom:1', dueAt: isoPlus(FIXED_NOW_ISO, 25) }}
        onCompleteCurrent={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const chip = container.querySelector('.chip--warning');
    expect(chipLabel(chip)).toBe('Bandage check in 25:00');
    expect(chip?.querySelector('svg')).toBeNull();
    expect(visibleText(chip)).toBe('BA in 25:00');
  });

  it('shows no timer chip without nextDue or when the task is unknown', () => {
    const p = patientFresh();
    const { container, rerender } = render(
      <PatientRow
        patient={p}
        now={FIXED_NOW_MS}
        urgency="none"
        onCompleteCurrent={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.chip--danger, .chip--warning')).toHaveLength(0);
    rerender(
      <PatientRow
        patient={p}
        now={FIXED_NOW_MS}
        urgency="none"
        nextDue={{ taskId: 'missing', dueAt: FIXED_NOW_ISO }}
        onCompleteCurrent={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('.chip--danger, .chip--warning')).toHaveLength(0);
  });

  it('shows the ward status chip for every status and none once discharged', () => {
    const cases: [Patient, string][] = [
      [patientFresh(), 'Waiting'],
      [patientPreOp(), 'Waiting'],
      [patientInTheatre(), 'Waiting'],
      [patientRecovery(), 'Recovery'],
    ];
    for (const [patient, label] of cases) {
      const { container, unmount } = row(patient);
      const chip = container.querySelector('.row__meta .chip');
      expect(chip?.textContent, patient.id).toBe(`Status ${label}`);
      unmount();
    }
    const theatre = patientInTheatre();
    const settled = theatre.tasks.map((t) =>
      t.key === 'in_theatre' ? { ...t, status: 'done' as const } : t,
    );
    const { container, unmount } = row({ ...theatre, tasks: settled });
    expect(container.querySelector('.row__meta .chip')?.textContent).toBe('Status In theatre');
    unmount();
    expect(row(patientDischarged()).container.querySelector('.row__meta .chip')).toBeNull();
  });

  it('shows the booked collection chip, in warning once the time has passed', () => {
    const p = patientPreOp();
    const later = row({ ...p, dischargeBookedAt: isoPlus(FIXED_NOW_ISO, 30) });
    const chip = later.container.querySelector('.row__side .chip.mono:last-child');
    expect(chip?.textContent).toBe(`Home ${formatClock(isoPlus(FIXED_NOW_ISO, 30))}`);
    expect(chip?.classList.contains('chip--warning')).toBe(false);
    later.unmount();

    const past = row({ ...p, dischargeBookedAt: isoPlus(FIXED_NOW_ISO, -1) });
    expect(past.container.querySelector('.row__side .chip--warning')?.textContent).toBe(
      `Home ${formatClock(isoPlus(FIXED_NOW_ISO, -1))}`,
    );
    expect(past.container.querySelectorAll('.row__side .chip')).toHaveLength(2);
    past.unmount();

    const gone = row({
      ...patientDischarged(),
      dischargeBookedAt: isoPlus(FIXED_NOW_ISO, -1),
    });
    expect(gone.container.querySelector('.row__side .chip')).toBeNull();
  });

  it('renders a belt with no cells as an empty belt, never as a complete one', () => {
    const { container } = row({ ...patientFresh(), tasks: [] });
    expect(container.querySelectorAll('.belt__square')).toHaveLength(0);
    const fill = container.querySelector<HTMLElement>('.row__progress-fill');
    expect(fill?.style.width).toBe('0%');
    expect(fill?.classList.contains('row__progress-fill--complete')).toBe(false);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      '0 of 0 done, nothing left to do',
    );
  });

  it('sizes the progress bar from done plus skipped and sweeps when complete', () => {
    const recovery = patientRecovery();
    const { container } = render(
      <PatientRow
        patient={recovery}
        now={FIXED_NOW_MS}
        urgency="none"
        onCompleteCurrent={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const fill = container.querySelector<HTMLElement>('.row__progress-fill');
    expect(fill?.style.width).toBe(`${(6 / 18) * 100}%`);
    expect(fill?.classList.contains('row__progress-fill--complete')).toBe(false);

    const done = patientDischarged();
    const complete = render(
      <PatientRow
        patient={done}
        now={FIXED_NOW_MS}
        urgency="none"
        onCompleteCurrent={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const fill2 = complete.container.querySelector<HTMLElement>('.row__progress-fill');
    expect(fill2?.style.width).toBe('100%');
    expect(fill2?.classList.contains('row__progress-fill--complete')).toBe(true);
    expect(complete.container.querySelector('.row__kennel')).toBeNull();
    expect(complete.container.querySelector('.chip')).toBeNull();
  });
});
