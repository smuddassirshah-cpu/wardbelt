// Decision notes: the board view (PLAN.md section 3). Rows come from boardRows, which sorts the
// active patients by urgency at state.now, so every TICK re-sorts and an overdue row rises to the
// top. The header carries the app name and the wall clock; the bottom bar is fixed with three
// 48 px buttons. Discharged patients hide behind a toggle and render without a current cell so
// the only live control on them is the header that opens the sheet. `inert` is set on the
// scrollable content and the bar while a sheet is open so focus cannot wander behind it. In a
// read-only tab every control is disabled.
import type { State } from '@domain/types';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { PatientRow } from './PatientRow';
import { boardRows, dischargedRows, type BoardRow } from './app/select';
import { formatClock } from './format';

export const EMPTY_MESSAGE = 'No patients on the board. Add one to start.';

export interface BoardProps {
  state: State;
  ready: boolean;
  readOnly: boolean;
  inert: boolean;
  notices?: ComponentChildren;
  onCompleteCurrent: (patientId: string, taskId: string) => void;
  onOpen: (patientId: string) => void;
  onAdd: () => void;
  onSummary: () => void;
  onSettings: () => void;
}

interface RowsProps {
  rows: BoardRow[];
  now: number;
  readOnly: boolean;
  onCompleteCurrent: BoardProps['onCompleteCurrent'];
  onOpen: BoardProps['onOpen'];
}

function Rows({ rows, now, readOnly, onCompleteCurrent, onOpen }: RowsProps) {
  return (
    <div class="board__rows">
      {rows.map(({ patient, currentTaskId, urgency, nextDue }) => (
        <PatientRow
          key={patient.id}
          patient={patient}
          now={now}
          currentTaskId={currentTaskId}
          urgency={urgency}
          nextDue={nextDue}
          readOnly={readOnly}
          onCompleteCurrent={() => {
            if (currentTaskId !== undefined) {
              onCompleteCurrent(patient.id, currentTaskId);
            }
          }}
          onOpen={() => {
            onOpen(patient.id);
          }}
        />
      ))}
    </div>
  );
}

export function Board(props: BoardProps) {
  const { state, ready, readOnly, inert, notices, onCompleteCurrent, onOpen } = props;
  const [showDischarged, setShowDischarged] = useState(false);
  const active = boardRows(state);
  const discharged = showDischarged ? dischargedRows(state) : [];
  const dischargedCount = Object.values(state.patients).filter(
    (p) => p.status === 'discharged',
  ).length;
  const clock = formatClock(new Date(state.now).toISOString());

  return (
    <div class="app">
      <header class="app__header">
        <h1>Wardbelt</h1>
        <span class="app__clock mono">
          <span class="visually-hidden">Time </span>
          {clock}
        </span>
      </header>
      {notices}
      <main class="app__main" inert={inert}>
        {!ready && <p class="board__status muted">Loading</p>}
        {ready && active.length === 0 && (
          <div class="board__empty">
            <p>{EMPTY_MESSAGE}</p>
            <button
              type="button"
              class="btn btn--primary"
              disabled={readOnly}
              onClick={props.onAdd}
            >
              Add patient
            </button>
          </div>
        )}
        {ready && active.length > 0 && (
          <Rows
            rows={active}
            now={state.now}
            readOnly={readOnly}
            onCompleteCurrent={onCompleteCurrent}
            onOpen={onOpen}
          />
        )}
        {ready && dischargedCount > 0 && (
          <section class="board__discharged" aria-label="Discharged patients">
            <button
              type="button"
              class="btn btn--quiet"
              aria-pressed={showDischarged}
              onClick={() => {
                setShowDischarged((v) => !v);
              }}
            >
              {showDischarged ? 'Hide discharged' : 'Show discharged'} ({dischargedCount})
            </button>
            {showDischarged && (
              <Rows
                rows={discharged}
                now={state.now}
                readOnly={readOnly}
                onCompleteCurrent={onCompleteCurrent}
                onOpen={onOpen}
              />
            )}
          </section>
        )}
      </main>
      <nav class="app__bar" aria-label="Main" inert={inert}>
        <button type="button" class="btn btn--primary" disabled={readOnly} onClick={props.onAdd}>
          Add patient
        </button>
        <button type="button" class="btn" disabled={readOnly} onClick={props.onSummary}>
          Summary
        </button>
        <button type="button" class="btn" disabled={readOnly} onClick={props.onSettings}>
          Settings
        </button>
      </nav>
    </div>
  );
}
