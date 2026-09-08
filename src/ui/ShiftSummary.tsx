// Decision notes: a plain stat list (PLAN.md section 1 non-goals: no badges, no confetti).
// Stats arrive computed; null means not measurable this shift and is shown as "n/a".
import { Sheet } from './Sheet';
import { formatMinutes, formatPercent } from './format';

export interface ShiftStats {
  tasksCompleted: number;
  tasksSkipped: number;
  checksOnTimePct: number | null;
  bestStreak: number;
  patientsAdmitted: number;
  patientsDischarged: number;
  medianAdmitToDischargeMin: number | null;
}

export interface ShiftSummaryProps {
  stats: ShiftStats;
  shiftLabel: string;
  onClose: () => void;
  inline?: boolean | undefined;
}

const NA = 'n/a';

function rows(s: ShiftStats): [string, string][] {
  return [
    ['Tasks completed', String(s.tasksCompleted)],
    ['Tasks skipped', String(s.tasksSkipped)],
    ['Checks on time', s.checksOnTimePct === null ? NA : formatPercent(s.checksOnTimePct)],
    ['Best on-time streak', String(s.bestStreak)],
    ['Patients admitted', String(s.patientsAdmitted)],
    ['Patients discharged', String(s.patientsDischarged)],
    [
      'Median admit to discharge',
      s.medianAdmitToDischargeMin === null ? NA : formatMinutes(s.medianAdmitToDischargeMin),
    ],
  ];
}

export function ShiftSummary({ stats, shiftLabel, onClose, inline }: ShiftSummaryProps) {
  return (
    <Sheet title="Shift summary" onClose={onClose} inline={inline}>
      <p class="summary-line">{shiftLabel}</p>
      <dl class="stats">
        {rows(stats).map(([label, value]) => (
          <div class="stats__item" key={label}>
            <dt class="stats__label">{label}</dt>
            <dd class="stats__value">{value}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
