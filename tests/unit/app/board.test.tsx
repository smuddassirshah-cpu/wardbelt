import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../../src/domain/reducer';
import { templateTaskId, type State } from '../../../src/domain/types';
import { Board, EMPTY_MESSAGE, type BoardProps } from '../../../src/ui/Board';
import { Belt } from '../../../src/ui/Belt';
import { PatientRow } from '../../../src/ui/PatientRow';
import {
  FIXED_NOW_MS,
  patientDischarged,
  patientFresh,
  patientPreOp,
  patientRecovery,
} from '../../fixtures/synthetic';

afterEach(cleanup);

function stateWith(...patients: ReturnType<typeof patientFresh>[]): State {
  return {
    ...initialState(FIXED_NOW_MS),
    patients: Object.fromEntries(patients.map((p) => [p.id, p])),
  };
}

function renderBoard(overrides: Partial<BoardProps> = {}) {
  const props: BoardProps = {
    state: stateWith(),
    ready: true,
    readOnly: false,
    inert: false,
    onCompleteCurrent: vi.fn(),
    onOpen: vi.fn(),
    onAdd: vi.fn(),
    onSummary: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
  return { ...render(<Board {...props} />), props };
}

describe('Board', () => {
  it('shows the app name, the local clock and a loading line before hydration', () => {
    renderBoard({ ready: false });
    expect(screen.getByRole('heading', { name: 'Wardbelt' })).toBeTruthy();
    const d = new Date(FIXED_NOW_MS);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    expect(screen.getByText(`${hh}:${mm}`).className).toContain('mono');
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });

  it('renders the empty state with a 48 px Add button and the bottom bar', () => {
    const { props } = renderBoard();
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    const adds = screen.getAllByRole('button', { name: 'Add patient' });
    expect(adds).toHaveLength(2);
    for (const b of adds) {
      expect(b.className).toContain('btn');
      fireEvent.click(b);
    }
    expect(props.onAdd).toHaveBeenCalledTimes(2);
    const bar = screen.getByRole('navigation', { name: 'Main' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Summary' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings' }));
    expect(props.onSummary).toHaveBeenCalledTimes(1);
    expect(props.onSettings).toHaveBeenCalledTimes(1);
  });

  it('sorts rows by urgency, completes the current cell and opens the sheet', () => {
    const { props } = renderBoard({
      state: stateWith(patientFresh(), patientPreOp(), patientRecovery()),
    });
    const names = Array.from(document.querySelectorAll('.row__name')).map((el) => el.textContent);
    expect(names).toEqual(['Fixture Dog One', 'Fixture Dog One', 'Fixture Cat Two']);
    const rows = document.querySelectorAll('article.row');
    expect(rows[0]?.getAttribute('data-urgency')).toBe('overdue');
    expect(rows[1]?.getAttribute('data-urgency')).toBe('intake');
    expect(rows[2]?.getAttribute('data-urgency')).toBe('intake');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Post-op check 1 (overdue)' }));
    expect(props.onCompleteCurrent).toHaveBeenCalledWith(
      'p-recovery',
      templateTaskId('p-recovery', 'check_1'),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Fixture Cat Two/ }));
    expect(props.onOpen).toHaveBeenCalledWith('p-preop');
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });

  it('lists discharged patients behind a toggle with no current cell', () => {
    const { props } = renderBoard({ state: stateWith(patientDischarged()) });
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Show discharged (1)' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelectorAll('article.row')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Hide discharged (1)' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(document.querySelectorAll('article.row')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Complete / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Fixture Other Four/ }));
    expect(props.onOpen).toHaveBeenCalledWith('p-discharged');
    fireEvent.click(screen.getByRole('button', { name: 'Hide discharged (1)' }));
    expect(document.querySelectorAll('article.row')).toHaveLength(0);
  });

  it('disables every control in a read-only tab and marks content inert under a sheet', () => {
    const { props, container } = renderBoard({
      state: stateWith(patientFresh()),
      readOnly: true,
      inert: true,
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const b of buttons) {
      expect(b.hasAttribute('disabled')).toBe(true);
    }
    expect(props.onCompleteCurrent).not.toHaveBeenCalled();
    expect(container.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('nav')?.hasAttribute('inert')).toBe(true);
  });
});

describe('read-only props on Belt and PatientRow', () => {
  it('Belt keeps the current cell as a disabled button', () => {
    const onTap = vi.fn();
    const p = patientFresh();
    render(
      <Belt
        tasks={p.tasks}
        currentTaskId={p.tasks[0]?.id}
        now={FIXED_NOW_MS}
        onTapCurrent={onTap}
        disabled
      />,
    );
    const button = screen.getByRole('button', { name: 'Complete Handover and admit' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('PatientRow disables the header and the belt when readOnly', () => {
    const onOpen = vi.fn();
    const p = patientFresh();
    render(
      <PatientRow
        patient={p}
        now={FIXED_NOW_MS}
        currentTaskId={p.tasks[0]?.id}
        urgency="intake"
        onCompleteCurrent={vi.fn()}
        onOpen={onOpen}
        readOnly
      />,
    );
    const header = screen.getByRole('button', { name: /^Fixture Dog One/ });
    expect(header.hasAttribute('disabled')).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Complete Handover and admit' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
