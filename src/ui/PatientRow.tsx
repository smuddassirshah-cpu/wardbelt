// Decision notes: the row is 88 px collapsed: 8 px padding, a 48 px header button, a 24 px
// belt, 7 px padding and the 1 px hairline, with the 2 px progress bar on the bottom edge.
// Urgency and the next due task are props; the row only formats them. The timer chip reads
// from nextDue and now; its
// code and countdown share one inline span because the chip is a flex container and a bare
// text node beside the code span would lose its leading space as a separate flex item.
import { type Iso, type Patient } from '@domain/types';
import { Belt } from './Belt';
import { Chip } from './Chip';
import { SPECIES_LABEL, classes, formatCountdown, progressOf, taskCode } from './format';

export type Urgency = 'overdue' | 'due_soon' | 'intake' | 'none';

export interface NextDue {
  taskId: string;
  dueAt: Iso;
}

export interface PatientRowProps {
  patient: Patient;
  now: number;
  currentTaskId?: string | undefined;
  urgency: Urgency;
  nextDue?: NextDue | undefined;
  onCompleteCurrent: () => void;
  onOpen: () => void;
  /** Read-only tab: header and current cell render but are disabled. */
  readOnly?: boolean | undefined;
}

function TimerChip({
  patient,
  nextDue,
  now,
}: Pick<PatientRowProps, 'patient' | 'nextDue' | 'now'>) {
  if (nextDue === undefined) {
    return null;
  }
  const task = patient.tasks.find((t) => t.id === nextDue.taskId);
  if (task === undefined) {
    return null;
  }
  const remaining = Date.parse(nextDue.dueAt) - now;
  const overdue = remaining <= 0;
  const code = taskCode(task);
  return (
    <Chip tone={overdue ? 'danger' : 'warning'} mono>
      <span class="visually-hidden">{`${task.label} `}</span>
      <span>
        <span aria-hidden="true">{code}</span>
        {overdue ? ` overdue ${formatCountdown(remaining)}` : ` in ${formatCountdown(remaining)}`}
      </span>
    </Chip>
  );
}

export function PatientRow({
  patient,
  now,
  currentTaskId,
  urgency,
  nextDue,
  onCompleteCurrent,
  onOpen,
  readOnly = false,
}: PatientRowProps) {
  const progress = progressOf(patient.tasks);
  const pct = progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
  return (
    <article class="row" data-urgency={urgency}>
      <button type="button" class="row__header" disabled={readOnly} onClick={onOpen}>
        <span class="row__main">
          <span class="row__title">
            <span class="row__name">{patient.name}</span>
            <span class="row__species">{SPECIES_LABEL[patient.species]}</span>
            {patient.kennel !== '' && <span class="row__kennel">{patient.kennel}</span>}
          </span>
          <span class="row__procedure">{patient.procedure}</span>
        </span>
        <span class="row__side">
          <TimerChip patient={patient} nextDue={nextDue} now={now} />
          {patient.intake !== 'none' && (
            <Chip tone={urgency === 'intake' ? 'accent' : 'neutral'} mono>
              <span class="visually-hidden">{'Intake '}</span>
              {patient.intake}
            </Chip>
          )}
        </span>
      </button>
      <div class="row__belt">
        <Belt
          tasks={patient.tasks}
          currentTaskId={currentTaskId}
          now={now}
          onTapCurrent={onCompleteCurrent}
          disabled={readOnly}
        />
      </div>
      <div class="row__progress" aria-hidden="true">
        <div
          class={classes('row__progress-fill', progress.complete && 'row__progress-fill--complete')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </article>
  );
}
