import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PatientRow } from '../../../src/ui/PatientRow';
import { templateTaskId } from '../../../src/domain/types';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  isoPlus,
  patientDischarged,
  patientFresh,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

afterEach(cleanup);

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
    expect(chip?.textContent).toBe('Post-op check 1 C1 overdue 05:00');
    expect(chip?.classList.contains('mono')).toBe(true);
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
    expect(container.querySelector('.chip--warning')?.textContent).toBe(
      'Bandage check BA in 25:00',
    );
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
    expect(fill?.style.width).toBe(`${(7 / 19) * 100}%`);
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
