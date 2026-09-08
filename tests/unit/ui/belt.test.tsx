import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Belt } from '../../../src/ui/Belt';
import { templateTaskId } from '../../../src/domain/types';
import {
  FIXED_NOW_MS,
  patientDischarged,
  patientFresh,
  patientPreOp,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

afterEach(cleanup);

describe('Belt', () => {
  it('renders one cell per task with two-letter codes and phase groups', () => {
    const p = patientFresh();
    const { container } = render(
      <Belt
        tasks={p.tasks}
        currentTaskId={templateTaskId('p-fresh', 'handover_admit')}
        now={FIXED_NOW_MS}
      />,
    );
    const squares = container.querySelectorAll('.belt__square');
    expect(squares).toHaveLength(19);
    expect(Array.from(squares, (s) => s.textContent)).toEqual([
      'HA',
      'BL',
      'DM',
      'PM',
      'TH',
      'IT',
      'HT',
      'C1',
      'C2',
      'C3',
      'C4',
      'FW',
      'TO',
      'PS',
      'IN',
      'CO',
      'PH',
      'IV',
      'DC',
    ]);
    expect(container.querySelectorAll('.belt__phase')).toHaveLength(5);
    for (const s of squares) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('marks exactly one current cell as a button and labels the belt', () => {
    const p = patientPreOp();
    const onTap = vi.fn();
    render(
      <Belt
        tasks={p.tasks}
        currentTaskId={templateTaskId('p-preop', 'premed')}
        now={FIXED_NOW_MS}
        onTapCurrent={onTap}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Complete Premed');
    expect(button.querySelector('.belt__square--current')?.textContent).toBe('PM');
    fireEvent.click(button);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      '3 of 19 done, current: Premed',
    );
  });

  it('styles done, skipped, todo and overdue cells', () => {
    const p = patientRecovery();
    const { container } = render(
      <Belt
        tasks={p.tasks}
        currentTaskId={templateTaskId('p-recovery', 'check_1')}
        now={FIXED_NOW_MS}
      />,
    );
    expect(container.querySelectorAll('.belt__square--done')).toHaveLength(7);
    expect(container.querySelectorAll('.belt__square--todo')).toHaveLength(11);
    const current = container.querySelector('.belt__square--current');
    expect(current?.classList.contains('belt__square--overdue')).toBe(true);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(
      'Complete Post-op check 1 (overdue)',
    );
    const preop = patientPreOp();
    const { container: c2 } = render(<Belt tasks={preop.tasks} now={FIXED_NOW_MS} />);
    expect(c2.querySelectorAll('.belt__square--skipped')).toHaveLength(1);
  });

  it('shows a non-current overdue cell in danger and a not-yet-due one plain', () => {
    const p = patientRecovery();
    const { container } = render(
      <Belt
        tasks={p.tasks}
        currentTaskId={templateTaskId('p-recovery', 'check_2')}
        now={FIXED_NOW_MS}
      />,
    );
    const overdue = container.querySelectorAll('.belt__square--overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.textContent).toBe('C1');
    const later = render(
      <Belt
        tasks={p.tasks}
        currentTaskId={templateTaskId('p-recovery', 'check_2')}
        now={FIXED_NOW_MS + 11 * 60_000}
      />,
    );
    expect(later.container.querySelectorAll('.belt__square--overdue')).toHaveLength(2);
  });

  it('uses the custom code for custom tasks and keeps them in their phase group', () => {
    const p = patientWithCustomTask();
    const { container } = render(<Belt tasks={p.tasks} now={FIXED_NOW_MS} compact />);
    expect(container.querySelectorAll('.belt__square')).toHaveLength(20);
    expect(container.querySelector('.belt')?.classList.contains('belt--compact')).toBe(true);
    const recovery = container.querySelectorAll('.belt__phase')[2];
    expect(recovery?.textContent).toContain('BA');
    expect(container.querySelectorAll('.belt__phase')).toHaveLength(5);
  });

  it('a complete belt has no button, is focusable and says nothing is left', () => {
    const p = patientDischarged();
    render(<Belt tasks={p.tasks} now={FIXED_NOW_MS} />);
    expect(screen.queryByRole('button')).toBeNull();
    const group = screen.getByRole('group');
    expect(group.getAttribute('tabindex')).toBe('0');
    expect(group.getAttribute('aria-label')).toBe('19 of 19 done, nothing left to do');
  });

  it('renders an empty task list without error', () => {
    const { container } = render(<Belt tasks={[]} now={FIXED_NOW_MS} />);
    expect(container.querySelectorAll('.belt__square')).toHaveLength(0);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      '0 of 0 done, nothing left to do',
    );
  });
});
