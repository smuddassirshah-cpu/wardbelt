// Decision notes: the reducer returns new references only for what changed, so the persist
// diff compares the previous and next state by identity: a patient entry with a different
// reference is saved, a missing one is deleted (the repo drops its events too), events are
// appended from the previous length when the previous tail is still in place (any other shape
// means events left with a deleted patient), and settings save when the object changed.
// RESET clears every store in one write instead of N deletes. Writes for one action are
// awaited in order; the caller chains actions so writes land in dispatch order. O(patients +
// new events) per action.
import type { State } from '@domain/types';
import type { Repo } from '@store/repo';

export function hasPersistableChange(prev: State, next: State): boolean {
  return (
    prev.patients !== next.patients ||
    prev.events !== next.events ||
    prev.settings !== next.settings
  );
}

export async function persistDiff(
  repo: Repo,
  prev: State,
  next: State,
  reset = false,
): Promise<void> {
  if (reset) {
    await repo.clearAll();
    return;
  }
  if (prev.patients !== next.patients) {
    for (const [id, patient] of Object.entries(next.patients)) {
      if (prev.patients[id] !== patient) {
        await repo.savePatient(patient);
      }
    }
    for (const id of Object.keys(prev.patients)) {
      if (next.patients[id] === undefined) {
        await repo.deletePatient(id);
      }
    }
  }
  if (prev.events !== next.events) {
    const from = prev.events.length;
    const appended = from === 0 || next.events[from - 1] === prev.events[from - 1];
    if (appended) {
      for (let i = from; i < next.events.length; i += 1) {
        const event = next.events[i];
        if (event !== undefined) {
          await repo.appendEvent(event);
        }
      }
    }
  }
  if (prev.settings !== next.settings) {
    await repo.saveSettings(next.settings);
  }
}
