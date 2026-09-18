// Decision notes: the row is 88 px collapsed: 8 px padding, a 48 px header button, a 24 px
// belt, 7 px padding and the 1 px hairline, with the 2 px progress bar on the bottom edge.
// Urgency and the next due task are props; the row only formats them. The header is two
// independent lines rather than a text column beside a chip column, so each line spends its own
// width: the name shares the first line with the countdown chip only, and the species, the ward
// status chip, the procedure, the intake chip and the booked collection chip share the second.
// The patient's name is the only text in the header allowed to be cut short, and only after the
// procedure has given way (CHANGES-2026-09.md section 5). The timer chip carries the step's icon
// and the countdown: the full label is there for screen readers only, because spelled out it
// fitted neither the chip nor the name at 393 px. The countdown starts with a non-breaking
// space, because an ordinary leading space at the start of a flex item is collapsed away and the
// chip would read "check 2in 04:30".
import { wardStatus, type WardStatus } from '@domain/status';
import { type Iso, type Patient } from '@domain/types';
import { Belt } from './Belt';
import { Chip } from './Chip';
import { TaskGlyph } from './icons';
import { SPECIES_LABEL, classes, formatClock, formatCountdown, progressOf } from './format';

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

export const WARD_STATUS_LABEL: Readonly<Record<WardStatus, string>> = Object.freeze({
  waiting: 'Waiting',
  theatre: 'In theatre',
  recovery: 'Recovery',
});

function StatusChip({ patient }: Pick<PatientRowProps, 'patient'>) {
  const status = wardStatus(patient);
  if (status === undefined) {
    return null;
  }
  return (
    <Chip>
      <span class="visually-hidden">{'Status '}</span>
      {WARD_STATUS_LABEL[status]}
    </Chip>
  );
}

/** Agreed collection time: neutral until it passes, then warning. Hidden once discharged. */
function BookedChip({ patient, now }: Pick<PatientRowProps, 'patient' | 'now'>) {
  const booked = patient.dischargeBookedAt;
  if (booked === undefined || patient.status === 'discharged') {
    return null;
  }
  return (
    <Chip tone={Date.parse(booked) <= now ? 'warning' : 'neutral'} mono>
      {`Home ${formatClock(booked)}`}
    </Chip>
  );
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
  return (
    <Chip tone={overdue ? 'danger' : 'warning'} mono>
      <span class="visually-hidden">{task.label}</span>
      <span class="chip__glyph" aria-hidden="true">
        <TaskGlyph task={task} />
      </span>
      <span>{`\u00a0${overdue ? 'overdue' : 'in'} ${formatCountdown(remaining)}`}</span>
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
  const intake = patient.intake !== 'none';
  const booked = patient.dischargeBookedAt !== undefined && patient.status !== 'discharged';
  return (
    <article class="row" data-urgency={urgency}>
      <button type="button" class="row__header" disabled={readOnly} onClick={onOpen}>
        <span class="row__title">
          <span class="row__name">{patient.name}</span>
          {patient.kennel !== '' && <span class="row__kennel">{patient.kennel}</span>}
          <TimerChip patient={patient} nextDue={nextDue} now={now} />
        </span>
        <span class="row__meta">
          <span class="row__species">{SPECIES_LABEL[patient.species]}</span>
          <StatusChip patient={patient} />
          <span class="row__procedure">{patient.procedure}</span>
          {(intake || booked) && (
            <span class="row__side">
              {intake && (
                <Chip tone={urgency === 'intake' ? 'accent' : 'neutral'} mono>
                  <span class="visually-hidden">{'Intake '}</span>
                  {patient.intake}
                </Chip>
              )}
              <BookedChip patient={patient} now={now} />
            </span>
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
