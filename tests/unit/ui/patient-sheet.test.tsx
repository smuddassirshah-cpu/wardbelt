import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientSheet, type PatientSheetProps } from '../../../src/ui/PatientSheet';
import { CONFIRM_WINDOW_MS } from '../../../src/ui/ConfirmButton';
import { templateTaskId, type Patient } from '../../../src/domain/types';
import { toDatetimeLocal } from '../../../src/ui/format';
import {
  FIXED_NOW_ISO,
  FIXED_NOW_MS,
  isoPlus,
  patientDischarged,
  patientPreOp,
  patientRecovery,
  patientWithCustomTask,
} from '../../fixtures/synthetic';

afterEach(cleanup);

function handlers() {
  return {
    onComplete: vi.fn(),
    onSkip: vi.fn(),
    onUndo: vi.fn(),
    onAddTask: vi.fn(),
    onSetNote: vi.fn(),
    onSetTheatreReturn: vi.fn(),
    onDischarge: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
}

function mount(patient: Patient, extra: Partial<PatientSheetProps> = {}) {
  const h = handlers();
  const utils = render(
    <PatientSheet
      patient={patient}
      now={FIXED_NOW_MS}
      currentTaskId={templateTaskId(patient.id, 'check_1')}
      canUndo
      {...h}
      {...extra}
    />,
  );
  return { ...utils, ...h };
}

describe('PatientSheet', () => {
  it('lists every task with code, label, status and time', () => {
    const p = patientRecovery();
    const { container } = mount(p);
    expect(screen.getByRole('dialog', { name: 'Fixture Dog One' })).toBeTruthy();
    const items = container.querySelectorAll('li.task');
    expect(items).toHaveLength(19);
    const first = items[0];
    expect(first?.querySelector('.belt__square--done')?.textContent).toBe('HA');
    expect(first?.textContent).toContain('Handover and admit');
    expect(first?.textContent).toContain('Done');
    const check1 = items[7];
    expect(check1?.querySelector('.belt__square--current.belt__square--overdue')).not.toBeNull();
    const due = toDatetimeLocal(isoPlus(FIXED_NOW_ISO, -5)).slice(11);
    expect(check1?.textContent).toContain(`Due ${due}`);
    expect(container.querySelectorAll('button[aria-label^="Complete "]')).toHaveLength(12);
    expect(container.querySelectorAll('button[aria-label^="Skip "]')).toHaveLength(12);
  });

  it('fires complete and skip with the task id', () => {
    const p = patientRecovery();
    const { onComplete, onSkip } = mount(p);
    fireEvent.click(screen.getByRole('button', { name: 'Complete Post-op check 2' }));
    expect(onComplete).toHaveBeenCalledWith(templateTaskId('p-recovery', 'check_2'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip Food and water' }));
    expect(onSkip).toHaveBeenCalledWith(templateTaskId('p-recovery', 'food_water'));
  });

  it('undo is enabled only when canUndo', () => {
    const p = patientRecovery();
    const {
      onUndo,
      rerender,
      onComplete,
      onSkip,
      onAddTask,
      onSetNote,
      onSetTheatreReturn,
      onDischarge,
      onDelete,
      onClose,
    } = mount(p);
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo.hasAttribute('disabled')).toBe(false);
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    rerender(
      <PatientSheet
        patient={p}
        now={FIXED_NOW_MS}
        canUndo={false}
        onComplete={onComplete}
        onSkip={onSkip}
        onUndo={onUndo}
        onAddTask={onAddTask}
        onSetNote={onSetNote}
        onSetTheatreReturn={onSetTheatreReturn}
        onDischarge={onDischarge}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('adds a valid custom task after the current task and resets the form', () => {
    const p = patientRecovery();
    const { onAddTask } = mount(p);
    const label = screen.getByLabelText('Task label');
    fireEvent.input(label, { target: { value: '  Bandage check ' } });
    const due = screen.getByLabelText('Due time (optional)');
    const dueLocal = toDatetimeLocal(isoPlus(FIXED_NOW_ISO, 25));
    fireEvent.input(due, { target: { value: dueLocal } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith(
      { label: 'Bandage check', dueAt: isoPlus(FIXED_NOW_ISO, 25) },
      templateTaskId('p-recovery', 'check_1'),
    );
    expect((label as HTMLInputElement).value).toBe('');
  });

  it('respects the chosen insert-after task', () => {
    const p = patientRecovery();
    const { onAddTask } = mount(p);
    fireEvent.input(screen.getByLabelText('Task label'), { target: { value: 'Weigh' } });
    const after = screen.getByLabelText('Insert after');
    fireEvent.change(after, { target: { value: templateTaskId('p-recovery', 'pain_score') } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith(
      { label: 'Weigh' },
      templateTaskId('p-recovery', 'pain_score'),
    );
  });

  it('shows inline errors for an invalid custom task and does not call onAddTask', () => {
    const p = patientRecovery();
    const { onAddTask } = mount(p);
    fireEvent.input(screen.getByLabelText('Due time (optional)'), {
      target: { value: toDatetimeLocal(isoPlus(FIXED_NOW_ISO, 3 * 24 * 60)) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).not.toHaveBeenCalled();
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByText('More than 48 hours ahead')).toBeTruthy();
    const label = screen.getByLabelText('Task label');
    expect(label.getAttribute('aria-invalid')).toBe('true');
    const describedBy = label.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Required');
    fireEvent.input(label, { target: { value: 'x'.repeat(61) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByText('At most 60 characters')).toBeTruthy();
  });

  it('defaults insert-after to the last task when there is no current task', () => {
    const p = patientDischarged();
    const { onAddTask } = mount(p, { currentTaskId: undefined });
    fireEvent.input(screen.getByLabelText('Task label'), { target: { value: 'Collar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith(
      { label: 'Collar' },
      templateTaskId('p-discharged', 'discharge'),
    );
  });

  it('saves patient notes on blur and on Save without duplicates', () => {
    const p = patientPreOp();
    const { onSetNote } = mount(p);
    const notes = screen.getByLabelText<HTMLTextAreaElement>('Patient notes');
    expect(notes.value).toBe('Nervous handler required');
    fireEvent.input(notes, { target: { value: 'Nervous handler required. Muzzle on. ' } });
    fireEvent.blur(notes);
    expect(onSetNote).toHaveBeenCalledWith(undefined, 'Nervous handler required. Muzzle on.');
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(onSetNote).toHaveBeenCalledTimes(1);
    fireEvent.input(notes, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(onSetNote).toHaveBeenLastCalledWith(undefined, '');
    expect(onSetNote).toHaveBeenCalledTimes(2);
  });

  it('edits a task note through the Note toggle', () => {
    const p = patientWithCustomTask();
    const { onSetNote, container } = mount(p);
    expect(container.querySelector('.task__note')?.textContent).toBe(
      'Left fore, check for slippage',
    );
    const toggle = screen.getByRole('button', { name: 'Edit note for Bandage check' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const editor = screen.getByLabelText<HTMLTextAreaElement>('Note for Bandage check');
    expect(editor.value).toBe('Left fore, check for slippage');
    fireEvent.input(editor, { target: { value: 'Right fore' } });
    fireEvent.blur(editor);
    expect(onSetNote).toHaveBeenCalledWith('p-custom:custom:1', 'Right fore');
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('Note for Bandage check')).toBeNull();
  });

  it('saves a theatre return time and rejects an empty one', () => {
    const p = patientRecovery();
    const { onSetTheatreReturn } = mount(p);
    const input = screen.getByLabelText<HTMLInputElement>('Back from theatre at');
    expect(input.value).toBe(toDatetimeLocal(isoPlus(FIXED_NOW_ISO, -20)));
    fireEvent.input(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save theatre return' }));
    expect(onSetTheatreReturn).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.input(input, { target: { value: toDatetimeLocal(isoPlus(FIXED_NOW_ISO, -10)) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save theatre return' }));
    expect(onSetTheatreReturn).toHaveBeenCalledWith(isoPlus(FIXED_NOW_ISO, -10));
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('discharges, and shows the discharge time once discharged', () => {
    const { onDischarge } = mount(patientRecovery());
    fireEvent.click(screen.getByRole('button', { name: 'Discharge' }));
    expect(onDischarge).toHaveBeenCalledTimes(1);
    cleanup();
    const done = patientDischarged();
    mount(done, { currentTaskId: undefined });
    const btn = screen.getByRole('button', { name: /^Discharged / });
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('shows the owner phone as a tel link only when present', () => {
    mount(patientPreOp());
    const link = screen.getByRole('link', { name: '+44 0000 000000' });
    expect(link.getAttribute('href')).toBe('tel:+440000000000');
    cleanup();
    mount(patientRecovery());
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('closes through the sheet', () => {
    const { onClose } = mount(patientRecovery());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('two-step delete', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('requires a second tap within the window', () => {
      const { onDelete } = mount(patientRecovery());
      fireEvent.click(screen.getByRole('button', { name: 'Delete patient' }));
      expect(onDelete).not.toHaveBeenCalled();
      const group = screen.getByRole('group', { name: 'Delete patient' });
      fireEvent.click(within(group).getByRole('button', { name: 'Confirm delete' }));
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
    });

    it('disarms after the window and on Keep', async () => {
      const { onDelete } = mount(patientRecovery());
      fireEvent.click(screen.getByRole('button', { name: 'Delete patient' }));
      expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeTruthy();
      await act(() => {
        vi.advanceTimersByTime(CONFIRM_WINDOW_MS);
      });
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Delete patient' }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});
