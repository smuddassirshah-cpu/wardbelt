// Decision notes: one pass over the tasks builds the phase groups (tasks arrive in order and a
// custom task carries the phase of its neighbour, so groups are contiguous). Only the current
// cell is a button; the other cells are aria-hidden spans and the belt itself carries a
// summary label. A belt with nothing left to do has no button, so the scroller becomes
// focusable itself to satisfy WCAG 2.1.1 for keyboard scrolling.
import { type Task } from '@domain/types';
import {
  cellClass,
  cellState,
  classes,
  isOverdue,
  progressOf,
  taskCode,
  type CellState,
} from './format';

export interface BeltProps {
  tasks: readonly Task[];
  currentTaskId?: string | undefined;
  now: number;
  onTapCurrent?: (() => void) | undefined;
  compact?: boolean;
  /** Read-only tab: the current cell stays a button for layout but cannot be tapped. */
  disabled?: boolean | undefined;
}

interface Cell {
  task: Task;
  state: CellState;
  overdue: boolean;
}

function groupByPhase(tasks: readonly Task[], currentTaskId: string | undefined, now: number) {
  const groups: Cell[][] = [];
  let phase: Task['phase'] | undefined;
  for (const task of tasks) {
    const cell: Cell = {
      task,
      state: cellState(task, currentTaskId),
      overdue: isOverdue(task, now),
    };
    const last = groups[groups.length - 1];
    if (last === undefined || task.phase !== phase) {
      groups.push([cell]);
      phase = task.phase;
    } else {
      last.push(cell);
    }
  }
  return groups;
}

function beltLabel(tasks: readonly Task[], currentTaskId: string | undefined): string {
  const { done, total } = progressOf(tasks);
  const current = tasks.find((t) => t.id === currentTaskId);
  const tail = current === undefined ? 'nothing left to do' : `current: ${current.label}`;
  return `${done} of ${total} done, ${tail}`;
}

export function Belt({
  tasks,
  currentTaskId,
  now,
  onTapCurrent,
  compact = false,
  disabled = false,
}: BeltProps) {
  const groups = groupByPhase(tasks, currentTaskId, now);
  const hasCurrent = tasks.some((t) => t.id === currentTaskId);
  return (
    <div
      class={classes('belt', compact && 'belt--compact')}
      role="group"
      aria-label={beltLabel(tasks, currentTaskId)}
      tabIndex={hasCurrent ? undefined : 0}
    >
      {groups.map((group) => (
        <div class="belt__phase" key={group[0]?.task.id}>
          {group.map(({ task, state, overdue }) =>
            state === 'current' ? (
              <button
                type="button"
                class="belt__hit"
                key={task.id}
                aria-label={`Complete ${task.label}${overdue ? ' (overdue)' : ''}`}
                disabled={disabled}
                onClick={onTapCurrent}
              >
                <span class={cellClass(state, overdue)} aria-hidden="true">
                  {taskCode(task)}
                </span>
              </button>
            ) : (
              <span class={cellClass(state, overdue)} key={task.id} aria-hidden="true">
                {taskCode(task)}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
