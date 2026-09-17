// Decision notes: the per-patient sheet. Every task row is at least 48 px with Complete and
// Skip for unfinished tasks and a Note toggle for any task; notes save on blur through a last-saved
// ref so blur followed by a Save tap never fires twice. The add-task form is validated at
// this boundary with validateCustomTask (PLAN.md section 7); the datetime-local value is
// handed to the validator as-is because it normalises local time to ISO UTC. Intake reuses the
// admission form's control and asks the same validator for the message, so there is one rule and
// one wording; it is offered on active patients only, since the reducer ignores an intake change
// on a discharged one. A booking is a local HH:MM on today's date turned into a UTC ISO stamp
// (CHANGES-2026-09.md section 5); it does not discharge anyone, so the Discharge button below it
// is untouched. Delete is an inline two-step confirm, never window.confirm.
import {
  NOTES_MAX,
  validateCustomTask,
  validatePatientForm,
  parseIso,
  type CustomTaskInput,
} from '@domain/validate';
import { type Intake, type Iso, type Patient, type Task } from '@domain/types';
import { useId, useRef, useState } from 'preact/hooks';
import { IntakeField, intakeValue } from './AddPatientSheet';
import { ConfirmButton } from './ConfirmButton';
import { Sheet } from './Sheet';
import { TaskGlyph } from './icons';
import {
  SPECIES_LABEL,
  cellClass,
  cellState,
  classes,
  formatClock,
  isOverdue,
  toDatetimeLocal,
} from './format';

export interface PatientSheetProps {
  patient: Patient;
  now: number;
  currentTaskId?: string | undefined;
  canUndo: boolean;
  onComplete: (taskId: string) => void;
  onSkip: (taskId: string) => void;
  onUndo: () => void;
  onAddTask: (input: CustomTaskInput, afterTaskId?: string) => void;
  onSetNote: (taskId: string | undefined, note: string) => void;
  onSetTheatreReturn: (returnedAt: Iso) => void;
  onSetIntake: (intake: Intake) => void;
  /** An agreed collection time, or undefined to clear the booking. */
  onBookDischarge: (bookedAt: Iso | undefined) => void;
  onDischarge: () => void;
  onDelete: () => void;
  onClose: () => void;
  inline?: boolean | undefined;
}

const SEX_LABEL: Readonly<Record<Patient['sex'], string>> = {
  M: 'Male',
  MN: 'Male neutered',
  F: 'Female',
  FN: 'Female neutered',
  unknown: 'Sex unknown',
};

const LABEL_MAX = 60;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const BOOKING_ERROR = 'Enter a collection time as HH:MM';

/** Today's local date at the chosen HH:MM, as a UTC ISO stamp; undefined when it is not a time. */
function bookingIso(raw: string | undefined, now: number): Iso | undefined {
  const match = TIME_RE.exec((raw ?? '').trim());
  if (match === null) {
    return undefined;
  }
  const [, hh = '0', mm = '0'] = match;
  const at = new Date(now);
  at.setHours(Number(hh), Number(mm), 0, 0);
  return at.toISOString();
}

/** The validator owns the intake rule and its wording; only its intake message is read here. */
function intakeError(value: Intake): string | undefined {
  const result = validatePatientForm({ intake: value });
  return result.ok ? undefined : result.errors.intake;
}

function useCommit(initial: string, save: (value: string) => void) {
  const saved = useRef(initial);
  return (value: string) => {
    if (value !== saved.current) {
      saved.current = value;
      save(value);
    }
  };
}

function taskStatus(task: Task, current: boolean, now: number) {
  if (task.status === 'done') {
    return { text: task.doneAt === undefined ? 'Done' : `Done ${formatClock(task.doneAt)}` };
  }
  if (task.status === 'skipped') {
    return { text: 'Skipped' };
  }
  if (task.dueAt !== undefined) {
    return { text: `Due ${formatClock(task.dueAt)}`, overdue: isOverdue(task, now) };
  }
  return { text: current ? 'Current' : 'To do' };
}

interface TaskRowProps {
  task: Task;
  current: boolean;
  now: number;
  onComplete: (taskId: string) => void;
  onSkip: (taskId: string) => void;
  onSetNote: (taskId: string | undefined, note: string) => void;
}

function TaskRow({ task, current, now, onComplete, onSkip, onSetNote }: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const noteId = useId();
  const commit = useCommit(task.note ?? '', (value) => {
    onSetNote(task.id, value);
  });
  const status = taskStatus(task, current, now);
  const overdue = isOverdue(task, now);
  return (
    <li class="task">
      <span
        class={cellClass(cellState(task, current ? task.id : undefined), overdue)}
        aria-hidden="true"
      >
        <TaskGlyph task={task} />
      </span>
      <div class="task__main">
        <div class={classes('task__label', task.status === 'skipped' && 'task__label--muted')}>
          {task.label}
        </div>
        <div class="task__meta">
          <span class={classes('mono', status.overdue === true && 'error-line')}>
            {status.text}
          </span>
          {task.custom && <span>Custom</span>}
        </div>
        {task.note !== undefined && task.note !== '' && !editing && (
          <div class="task__note">{task.note}</div>
        )}
      </div>
      <div class="task__actions">
        {task.status === 'todo' && (
          <>
            <button
              type="button"
              class="btn btn--primary"
              aria-label={`Complete ${task.label}`}
              onClick={() => {
                onComplete(task.id);
              }}
            >
              Done
            </button>
            <button
              type="button"
              class="btn"
              aria-label={`Skip ${task.label}`}
              onClick={() => {
                onSkip(task.id);
              }}
            >
              Skip
            </button>
          </>
        )}
        <button
          type="button"
          class="btn btn--quiet"
          aria-label={`Edit note for ${task.label}`}
          aria-expanded={editing}
          onClick={() => {
            setEditing((v) => !v);
          }}
        >
          Note
        </button>
      </div>
      {editing && (
        <div class="task__editor field">
          <label class="field__label" for={noteId}>
            Note for {task.label}
          </label>
          <textarea
            id={noteId}
            class="field__input"
            maxLength={NOTES_MAX}
            defaultValue={task.note ?? ''}
            onBlur={(e) => {
              commit(e.currentTarget.value.trim());
            }}
          />
        </div>
      )}
    </li>
  );
}

interface AddTaskFormProps {
  tasks: readonly Task[];
  defaultAfter: string | undefined;
  now: number;
  onAddTask: PatientSheetProps['onAddTask'];
}

function AddTaskForm({ tasks, defaultAfter, now, onAddTask }: AddTaskFormProps) {
  const id = useId();
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [after, setAfter] = useState(defaultAfter ?? '');
  const form = useRef<HTMLFormElement>(null);
  const labelId = `${id}-label`;
  const dueId = `${id}-due`;
  const afterId = `${id}-after`;

  const onSubmit = (e: Event) => {
    e.preventDefault();
    const el = form.current;
    if (el === null) {
      return;
    }
    const data = new FormData(el);
    const result = validateCustomTask(
      { label: data.get('label'), dueAt: data.get('dueAt') ?? '' },
      now,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onAddTask(result.value, after === '' ? undefined : after);
    el.reset();
  };

  return (
    <form ref={form} onSubmit={onSubmit} noValidate>
      <div class="field">
        <label class="field__label" for={labelId}>
          Task label
        </label>
        <input
          id={labelId}
          name="label"
          class="field__input"
          type="text"
          maxLength={LABEL_MAX}
          autoComplete="off"
          aria-invalid={errors.label !== undefined ? 'true' : undefined}
          aria-describedby={errors.label !== undefined ? `${labelId}-error` : undefined}
        />
        {errors.label !== undefined && (
          <p class="field__error" id={`${labelId}-error`}>
            {errors.label}
          </p>
        )}
      </div>
      <div class="field">
        <label class="field__label" for={dueId}>
          Due time (optional)
        </label>
        <input
          id={dueId}
          name="dueAt"
          class="field__input"
          type="datetime-local"
          aria-invalid={errors.dueAt !== undefined ? 'true' : undefined}
          aria-describedby={errors.dueAt !== undefined ? `${dueId}-error` : undefined}
        />
        {errors.dueAt !== undefined && (
          <p class="field__error" id={`${dueId}-error`}>
            {errors.dueAt}
          </p>
        )}
      </div>
      <div class="field">
        <label class="field__label" for={afterId}>
          Insert after
        </label>
        <select
          id={afterId}
          name="after"
          class="field__input"
          value={after}
          onChange={(e) => {
            setAfter(e.currentTarget.value);
          }}
        >
          {tasks.map((t) => (
            <option value={t.id} key={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" class="btn btn--primary">
        Add task
      </button>
    </form>
  );
}

export function PatientSheet(props: PatientSheetProps) {
  const {
    patient,
    now,
    currentTaskId,
    canUndo,
    onComplete,
    onSkip,
    onUndo,
    onAddTask,
    onSetNote,
    onSetTheatreReturn,
    onSetIntake,
    onBookDischarge,
    onDischarge,
    onDelete,
    onClose,
    inline,
  } = props;
  const id = useId();
  const notesId = `${id}-notes`;
  const returnId = `${id}-return`;
  const intakeId = `${id}-intake`;
  const bookingId = `${id}-booking`;
  const [returnError, setReturnError] = useState<string | undefined>(undefined);
  const [intakeMessage, setIntakeMessage] = useState<string | undefined>(undefined);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingError, setBookingError] = useState<string | undefined>(undefined);
  const returnInput = useRef<HTMLInputElement>(null);
  const intakeInput = useRef<HTMLInputElement>(null);
  const bookingInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const commitNotes = useCommit(patient.notes, (value) => {
    onSetNote(undefined, value);
  });
  const lastTask = patient.tasks[patient.tasks.length - 1];
  const weight = patient.weightKg === undefined ? undefined : `${patient.weightKg} kg`;
  const discharged = patient.status === 'discharged';

  const saveReturn = () => {
    const iso = parseIso(returnInput.current?.value);
    if (iso === undefined) {
      setReturnError('Enter the date and time the patient came back from theatre');
      return;
    }
    setReturnError(undefined);
    onSetTheatreReturn(iso);
  };

  const saveIntake = () => {
    const value = intakeValue(intakeInput.current?.value);
    const message = intakeError(value);
    setIntakeMessage(message);
    if (message === undefined) {
      onSetIntake(value);
    }
  };

  const saveBooking = () => {
    const iso = bookingIso(bookingInput.current?.value, now);
    if (iso === undefined) {
      setBookingError(BOOKING_ERROR);
      return;
    }
    setBookingError(undefined);
    setBookingOpen(false);
    onBookDischarge(iso);
  };

  const clearBooking = () => {
    setBookingError(undefined);
    setBookingOpen(false);
    onBookDischarge(undefined);
  };

  return (
    <Sheet title={patient.name} onClose={onClose} inline={inline}>
      <section class="section" aria-label="Patient details">
        <p class="summary-line">
          <strong>{patient.procedure}</strong>
        </p>
        <p class="summary-line">
          {[
            SPECIES_LABEL[patient.species],
            patient.breed !== '' ? patient.breed : undefined,
            SEX_LABEL[patient.sex],
            weight,
          ]
            .filter((s): s is string => s !== undefined)
            .join(', ')}
        </p>
        <p class="summary-line">
          {patient.kennel !== '' && (
            <>
              Kennel <span class="mono">{patient.kennel}</span>.{' '}
            </>
          )}
          {patient.intake !== 'none' && (
            <>
              Intake <span class="mono">{patient.intake}</span>.{' '}
            </>
          )}
          Admitted <span class="mono">{formatClock(patient.createdAt)}</span>.
        </p>
        {patient.ownerPhone !== undefined && (
          <p class="summary-line">
            Owner{' '}
            <a class="btn btn--quiet mono" href={`tel:${patient.ownerPhone.replace(/ /g, '')}`}>
              {patient.ownerPhone}
            </a>
          </p>
        )}
      </section>

      <section class="section" aria-label="Task list">
        <div class="btn-row section__title">
          <h3>Tasks</h3>
          <button type="button" class="btn" disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
        </div>
        <ul>
          {patient.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              current={task.id === currentTaskId}
              now={now}
              onComplete={onComplete}
              onSkip={onSkip}
              onSetNote={onSetNote}
            />
          ))}
        </ul>
      </section>

      <section class="section" aria-label="Add a task">
        <h3 class="section__title">Add task</h3>
        <AddTaskForm
          tasks={patient.tasks}
          defaultAfter={currentTaskId ?? lastTask?.id}
          now={now}
          onAddTask={onAddTask}
        />
      </section>

      <section class="section" aria-label="Notes">
        <div class="field">
          <label class="field__label" for={notesId}>
            Patient notes
          </label>
          <textarea
            id={notesId}
            ref={notesInput}
            class="field__input"
            maxLength={NOTES_MAX}
            defaultValue={patient.notes}
            onBlur={(e) => {
              commitNotes(e.currentTarget.value.trim());
            }}
          />
          <p class="field__hint">Saved when you leave the box or tap Save.</p>
        </div>
        <button
          type="button"
          class="btn"
          onClick={() => {
            const el = notesInput.current;
            if (el !== null) {
              commitNotes(el.value.trim());
            }
          }}
        >
          Save notes
        </button>
      </section>

      <section class="section" aria-label="Theatre return">
        <div class="field">
          <label class="field__label" for={returnId}>
            Back from theatre at
          </label>
          <input
            id={returnId}
            ref={returnInput}
            class="field__input"
            type="datetime-local"
            defaultValue={
              patient.theatreReturnAt === undefined ? '' : toDatetimeLocal(patient.theatreReturnAt)
            }
            aria-invalid={returnError !== undefined ? 'true' : undefined}
            aria-describedby={returnError !== undefined ? `${returnId}-error` : undefined}
          />
          {returnError !== undefined && (
            <p class="field__error" id={`${returnId}-error`}>
              {returnError}
            </p>
          )}
          <p class="field__hint">Sets the four post-op checks at 15, 30, 45 and 60 minutes.</p>
        </div>
        <button type="button" class="btn" onClick={saveReturn}>
          Save theatre return
        </button>
      </section>

      {!discharged && (
        <section class="section" aria-label="Intake">
          <IntakeField
            id={intakeId}
            defaultValue={patient.intake === 'none' ? '' : patient.intake}
            error={intakeMessage}
            inputRef={intakeInput}
          />
          <button type="button" class="btn" onClick={saveIntake}>
            Save intake
          </button>
        </section>
      )}

      <section class="section" aria-label="Discharge">
        {patient.dischargeBookedAt !== undefined && (
          <p class="summary-line">
            Booked for <span class="mono">{formatClock(patient.dischargeBookedAt)}</span>
          </p>
        )}
        {!discharged && !bookingOpen && (
          <div class="btn-row">
            <button
              type="button"
              class="btn"
              onClick={() => {
                setBookingOpen(true);
              }}
            >
              Book discharge
            </button>
          </div>
        )}
        {!discharged && bookingOpen && (
          <>
            <div class="field">
              <label class="field__label" for={bookingId}>
                Collection time
              </label>
              <input
                id={bookingId}
                ref={bookingInput}
                class="field__input mono"
                type="time"
                defaultValue={
                  patient.dischargeBookedAt === undefined
                    ? ''
                    : formatClock(patient.dischargeBookedAt)
                }
                aria-invalid={bookingError !== undefined ? 'true' : undefined}
                aria-describedby={bookingError !== undefined ? `${bookingId}-error` : undefined}
              />
              {bookingError !== undefined && (
                <p class="field__error" id={`${bookingId}-error`}>
                  {bookingError}
                </p>
              )}
              <p class="field__hint">The collection time agreed with the owner, today.</p>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn--primary" onClick={saveBooking}>
                Save booking
              </button>
              {patient.dischargeBookedAt !== undefined && (
                <button type="button" class="btn" onClick={clearBooking}>
                  Clear booking
                </button>
              )}
            </div>
          </>
        )}
        <div class="btn-row">
          <button
            type="button"
            class="btn btn--primary"
            disabled={discharged}
            onClick={onDischarge}
          >
            {discharged && patient.dischargedAt !== undefined
              ? `Discharged ${formatClock(patient.dischargedAt)}`
              : 'Discharge'}
          </button>
          <ConfirmButton
            label="Delete patient"
            confirmLabel="Confirm delete"
            onConfirm={onDelete}
          />
        </div>
      </section>
    </Sheet>
  );
}
