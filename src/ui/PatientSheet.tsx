// Decision notes: the per-patient sheet. Every task row is at least 48 px with Complete and
// Skip for unfinished tasks and a Note toggle for any task; notes save on blur through a last-saved
// ref so blur followed by a Save tap never fires twice. The add-task form is validated at
// this boundary with validateCustomTask (PLAN.md section 7); the datetime-local value is
// handed to the validator as-is because it normalises local time to ISO UTC. Delete is an
// inline two-step confirm, never window.confirm.
import { validateCustomTask, parseIso, type CustomTaskInput } from '@domain/validate';
import { type Iso, type Patient, type Task } from '@domain/types';
import { useId, useRef, useState } from 'preact/hooks';
import { ConfirmButton } from './ConfirmButton';
import { Sheet } from './Sheet';
import {
  SPECIES_LABEL,
  cellClass,
  cellState,
  classes,
  formatClock,
  isOverdue,
  taskCode,
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

const NOTE_MAX = 500;
const LABEL_MAX = 60;

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
        {taskCode(task)}
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
            maxLength={NOTE_MAX}
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
    onDischarge,
    onDelete,
    onClose,
    inline,
  } = props;
  const id = useId();
  const notesId = `${id}-notes`;
  const returnId = `${id}-return`;
  const [returnError, setReturnError] = useState<string | undefined>(undefined);
  const returnInput = useRef<HTMLInputElement>(null);
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
            maxLength={NOTE_MAX}
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

      <section class="section" aria-label="Discharge and delete">
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
