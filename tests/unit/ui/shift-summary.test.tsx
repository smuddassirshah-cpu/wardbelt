import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShiftSummary } from '../../../src/ui/ShiftSummary';

afterEach(cleanup);

describe('ShiftSummary', () => {
  it('lists every stat with its value', () => {
    const onClose = vi.fn();
    render(
      <ShiftSummary
        stats={{
          tasksCompleted: 41,
          tasksSkipped: 3,
          checksOnTimePct: 87.5,
          bestStreak: 9,
          patientsAdmitted: 6,
          patientsDischarged: 4,
          medianAdmitToDischargeMin: 312,
        }}
        shiftLabel="Tuesday"
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Shift summary' })).toBeTruthy();
    expect(screen.getByText('Tuesday')).toBeTruthy();
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    const values = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(terms).toEqual([
      'Tasks completed',
      'Tasks skipped',
      'Checks on time',
      'Best on-time streak',
      'Patients admitted',
      'Patients discharged',
      'Median admit to discharge',
    ]);
    expect(values).toEqual(['41', '3', '88%', '9', '6', '4', '5 h 12 min']);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows n/a for null stats', () => {
    render(
      <ShiftSummary
        stats={{
          tasksCompleted: 0,
          tasksSkipped: 0,
          checksOnTimePct: null,
          bestStreak: 0,
          patientsAdmitted: 0,
          patientsDischarged: 0,
          medianAdmitToDischargeMin: null,
        }}
        shiftLabel="Empty"
        onClose={vi.fn()}
        inline
      />,
    );
    const values = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(values).toEqual(['0', '0', 'n/a', '0', '0', '0', 'n/a']);
  });
});
