// Decision notes: one signal holds the domain State (PLAN.md section 6). dispatch reduces,
// moves `now` to the action's own timestamp (or the clock for unstamped actions) so the board
// re-sorts on every action and a fresh countdown reads exactly 15:00, publishes
// the new state, then queues the persist diff on a single promise chain so writes for
// successive actions land in order. The repo surfaces storage failures through its notices and
// never rejects on them; anything that does reject the chain (a throwing notice listener) is
// reported through onError and the chain carries on. Hydration builds the state from a
// LoadResult without appending events or writing anything. Change listeners run after every
// state change so the scheduler can re-arm. The repo may arrive as a promise: the chain then
// starts by waiting for it, so a write can never run against a missing repo.
import { initialState, reduce } from '@domain/reducer';
import type { Action, Patient, State } from '@domain/types';
import type { Clock } from '@scheduler/clock';
import type { LoadResult, Repo } from '@store/repo';
import { signal, type Signal } from '@preact/signals';
import { describeError } from './errors';
import { hasPersistableChange, persistDiff } from './persist';

export interface AppStore {
  readonly state: Signal<State>;
  dispatch: (action: Action) => void;
  hydrate: (load: Pick<LoadResult, 'patients' | 'events' | 'settings'>) => void;
  subscribe: (listener: () => void) => () => void;
  /** Resolves when every queued write so far has been submitted to the repo. */
  flush: () => Promise<void>;
}

export interface StoreDeps {
  /** The repo, or a promise of it when the app renders before boot has finished. */
  repo: Repo | Promise<Repo>;
  clock: Clock;
  onError: (reason: string) => void;
}

/** Stamped actions carry the moment they happened; `now` follows it so due countdowns are exact. */
function actionTime(action: Action): number | undefined {
  if ('now' in action) {
    return action.now;
  }
  if ('at' in action) {
    const ms = Date.parse(action.at);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

export function createStore({ repo: given, clock, onError }: StoreDeps): AppStore {
  const state = signal<State>(initialState(clock.now()));
  const listeners = new Set<() => void>();
  let repo: Repo | undefined = given instanceof Promise ? undefined : given;
  let chain: Promise<void> =
    given instanceof Promise
      ? given.then((r) => {
          repo = r;
        })
      : Promise.resolve();
  const persist = (prev: State, next: State, reset: boolean): Promise<void> => {
    if (repo === undefined) {
      return Promise.reject(new Error('storage is not ready'));
    }
    return persistDiff(repo, prev, next, reset);
  };

  const publish = (next: State): void => {
    state.value = next;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    state,
    dispatch: (action) => {
      const prev = state.value;
      const now = actionTime(action) ?? clock.now();
      let next = reduce(prev, action);
      if (next.now !== now) {
        next = { ...next, now };
      }
      if (next === prev) {
        return;
      }
      const reset = action.type === 'RESET';
      if (reset || hasPersistableChange(prev, next)) {
        chain = chain
          .then(() => persist(prev, next, reset))
          .catch((e: unknown) => {
            onError(`Not saving: ${describeError(e)}`);
          });
      }
      publish(next);
    },
    hydrate: (load) => {
      const patients: Record<string, Patient> = {};
      for (const p of load.patients) {
        patients[p.id] = p;
      }
      publish({ patients, events: load.events, settings: load.settings, now: clock.now() });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush: () => chain,
  };
}
