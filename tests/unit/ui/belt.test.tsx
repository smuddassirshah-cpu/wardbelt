import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Belt } from '../../../src/ui/Belt';
import { templateTaskId } from '../../../src/domain/types';
import { TEMPLATE } from '../../../src/domain/template';
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
  it('renders one icon cell per template step, in phase groups', () => {
    const p = patientFresh();
    const { container } = render(
      <Belt
        tasks={p.tasks}
        currentTaskId={templateTaskId('p-fresh', 'handover_admit')}
        now={FIXED_NOW_MS}
      />,
    );
    const squares = container.querySelectorAll('.belt__square');
    expect(squares).toHaveLength(18);
    expect(Array.from(squares, (s) => s.querySelector('svg')?.getAttribute('data-icon'))).toEqual(
      TEMPLATE.map((step) => step.key),
    );
    for (const svg of container.querySelectorAll('.belt__square svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg.getAttribute('stroke-width')).toBe('1.5');
    }
    expect(container.textContent).toBe('1234');
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
    expect(button.querySelector('.belt__square--current svg')?.getAttribute('data-icon')).toBe(
      'premed',
    );
    fireEvent.click(button);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      '3 of 18 done, current: Premed',
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
    expect(container.querySelectorAll('.belt__square--done')).toHaveLength(6);
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
    expect(overdue[0]?.querySelector('svg')?.getAttribute('data-icon')).toBe('check_1');
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
    expect(container.querySelectorAll('.belt__square')).toHaveLength(19);
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
    expect(group.getAttribute('aria-label')).toBe('18 of 18 done, nothing left to do');
  });

  it('renders an empty task list without error', () => {
    const { container } = render(<Belt tasks={[]} now={FIXED_NOW_MS} />);
    expect(container.querySelectorAll('.belt__square')).toHaveLength(0);
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe(
      '0 of 0 done, nothing left to do',
    );
  });
});
