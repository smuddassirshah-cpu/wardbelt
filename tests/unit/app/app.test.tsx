import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { templateTaskId } from '../../../src/domain/types';
import { App, shiftLabel } from '../../../src/ui/App';
import { EMPTY_MESSAGE } from '../../../src/ui/Board';
import { emptyLoad } from '../../../src/ui/app/boot';
import { STORAGE_UNAVAILABLE } from '../../../src/ui/app/notices';
import { createRouter } from '../../../src/ui/app/router';
import { createSession, LOCK_HELD_MESSAGE } from '../../../src/ui/app/session';
import { EXPORT_NUDGE_MS, NUDGE_MESSAGE } from '../../../src/ui/app/transfer';
import { EXPORT_TEXT_LABEL } from '../../../src/ui/Settings';
import { FIXED_NOW_MS, patientFresh, patientRecovery } from '../../fixtures/synthetic';
import { fakePlatform, fakeRepo, type FakePlatformOptions } from './helpers';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected an element');
  }
  return value;
}

async function mount(options: FakePlatformOptions = {}) {
  const platform = fakePlatform(options);
  const session = createSession(platform);
  const router = createRouter(window);
  render(<App session={session} router={router} />);
  await act(async () => {
    await session.start();
  });
  return { platform, session, router };
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe('App', () => {
  it('shows the shell before boot and the empty board after', async () => {
    const platform = fakePlatform();
    const session = createSession(platform);
    render(<App session={session} router={createRouter(window)} />);
    expect(screen.getByRole('heading', { name: 'Wardbelt' })).toBeTruthy();
    expect(screen.getByText('Loading')).toBeTruthy();
    await act(async () => {
      await session.start();
    });
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds a patient through the sheet, completes from the sheet, undoes from the toast, deletes', async () => {
    const { platform } = await mount();
    const bar = screen.getByRole('navigation', { name: 'Main' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Add patient' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add patient' });
    expect(location.hash).toBe('#/add');
    fireEvent.input(within(sheet).getByLabelText('Name'), { target: { value: 'Fixture Lambda' } });
    fireEvent.input(within(sheet).getByLabelText('Procedure'), { target: { value: 'Dental' } });
    fireEvent.submit(must(sheet.querySelector('form')));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(location.hash).toBe('');
    expect(screen.getByText('Fixture Lambda')).toBeTruthy();
    await waitFor(() => {
      expect(platform.repo.calls.map((c) => c.op)).toEqual(['savePatient', 'appendEvent']);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Fixture Lambda/ }));
    const patientSheet = await screen.findByRole('dialog', { name: 'Fixture Lambda' });
    expect(location.hash).toMatch(/^#\/patient\//);
    expect(
      within(patientSheet).getByRole('button', { name: 'Undo' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(
      within(patientSheet).getByRole('button', { name: 'Complete Handover and admit' }),
    );
    const toast = await screen.findByText('Handover and admit completed');
    fireEvent.click(within(must(toast.parentElement)).getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.queryByText('Handover and admit completed')).toBeNull();
    });
    expect(
      within(patientSheet).getByRole('button', { name: 'Complete Handover and admit' }),
    ).toBeTruthy();

    fireEvent.click(within(patientSheet).getByRole('button', { name: 'Delete patient' }));
    fireEvent.click(within(patientSheet).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(location.hash).toBe('');
  });

  it('completes from the board cell and lets the toast expire', async () => {
    vi.useFakeTimers();
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    await mount({ repo });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Handover and admit' }));
    await act(() => undefined);
    expect(screen.getByText('Handover and admit completed')).toBeTruthy();
    await act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Handover and admit completed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Complete Bloods' })).toBeTruthy();
    vi.useRealTimers();
  });

  it('routes to the summary and settings sheets and applies the theme', async () => {
    const { platform } = await mount();
    const bar = screen.getByRole('navigation', { name: 'Main' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Summary' }));
    const summary = await screen.findByRole('dialog', { name: 'Shift summary' });
    expect(within(summary).getByText(shiftLabel(FIXED_NOW_MS))).toBeTruthy();
    expect(shiftLabel(FIXED_NOW_MS)).toMatch(
      /^Shift from 04:00 [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/,
    );
    expect(shiftLabel(new Date(2026, 2, 10, 3, 59).getTime())).toBe('Shift from 04:00 Mon 9 Mar');
    expect(shiftLabel(new Date(2026, 2, 10, 4, 0).getTime())).toBe('Shift from 04:00 Tue 10 Mar');
    fireEvent.click(within(summary).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(within(bar).getByRole('button', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(settings).getByText('Saving to this phone')).toBeTruthy();
    expect(within(settings).getByText('Version test')).toBeTruthy();
    fireEvent.click(within(settings).getByLabelText('Dark'));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    fireEvent.click(within(settings).getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(platform.downloads).toHaveLength(1);
    });
    expect(await screen.findByText('Exported')).toBeTruthy();
    fireEvent.click(within(settings).getByRole('button', { name: 'Delete everything' }));
    fireEvent.click(within(settings).getByRole('button', { name: 'Confirm delete everything' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('renders the storage, corrupt, update and read-only banners', async () => {
    const repo = fakeRepo();
    repo.loadResult = {
      ...emptyLoad(),
      patients: [patientRecovery()],
      corrupt: 1,
      rawCorrupt: ['x'],
    };
    repo.load = () => {
      repo.emit({ kind: 'corrupt', count: 1 });
      return Promise.resolve(repo.loadResult);
    };
    const { platform, session, router } = await mount({ repo, role: 'readonly' });
    expect(screen.getByText(LOCK_HELD_MESSAGE)).toBeTruthy();
    expect(screen.getByText('1 record could not be read')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export raw records' }));
    expect(platform.downloads[0]?.text).toContain('raw-corrupt-records');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(screen.queryByText('1 record could not be read')).toBeNull();
    });
    const bar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(bar).getByRole('button', { name: 'Add patient' }).hasAttribute('disabled')).toBe(
      true,
    );
    router.navigate({ kind: 'add' });
    await act(() => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    session.actions.complete('p-recovery', templateTaskId('p-recovery', 'check_1'));
    expect(
      session.state.value.patients['p-recovery']?.tasks.find((t) => t.key === 'check_1')?.status,
    ).toBe('todo');

    await act(() => {
      repo.emit({ kind: 'unavailable', reason: 'private' });
      platform.sw.options()?.onNeedRefresh?.();
    });
    expect(screen.getByText(STORAGE_UNAVAILABLE)).toBeTruthy();
    const update = screen.getByText('Update ready');
    fireEvent.click(within(must(update.parentElement)).getByRole('button', { name: 'Reload' }));
    expect(platform.sw.update).toHaveBeenCalledWith(true);
  });

  it('wires every patient sheet action: skip, add task, notes, theatre return, discharge', async () => {
    const vibrate = vi.fn(() => {
      throw new Error('no motor');
    });
    vi.stubGlobal('navigator', { vibrate });
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { session, router } = await mount({ repo });
    router.navigate({ kind: 'patient', id: 'p-fresh' });
    const sheet = await screen.findByRole('dialog', { name: 'Fixture Dog One' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Skip Bloods' }));
    expect(await screen.findByText('Bloods skipped')).toBeTruthy();

    fireEvent.input(within(sheet).getByLabelText('Task label'), {
      target: { value: 'Bandage check' },
    });
    fireEvent.submit(must(within(sheet).getByLabelText('Task label').closest('form')));
    await waitFor(() => {
      expect(within(sheet).getAllByText('Bandage check').length).toBeGreaterThanOrEqual(1);
    });
    expect(session.state.value.patients['p-fresh']?.tasks[1]?.label).toBe('Bandage check');

    fireEvent.input(within(sheet).getByLabelText('Patient notes'), { target: { value: 'Calm' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save notes' }));
    expect(session.state.value.patients['p-fresh']?.notes).toBe('Calm');

    fireEvent.input(within(sheet).getByLabelText('Back from theatre at'), {
      target: { value: '2026-03-10T09:00' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save theatre return' }));
    expect(session.state.value.patients['p-fresh']?.theatreReturnAt).toBeDefined();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Discharge' }));
    await waitFor(() => {
      expect(within(sheet).getByRole('button', { name: /^Discharged \d\d:\d\d$/ })).toBeTruthy();
    });
    expect(session.state.value.patients['p-fresh']?.status).toBe('discharged');
    expect(await screen.findByText('Fixture Dog One discharged')).toBeTruthy();
    expect(session.banners.transient.value).toBe('Error: no motor');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Show discharged (1)' })).toBeTruthy();
  });

  it('shows the weekly export nudge, exports from it, and dismisses it for the session', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { platform, session } = await mount({ repo });
    const nudge = screen.getByText(NUDGE_MESSAGE);
    const bar = must(nudge.parentElement);
    fireEvent.click(within(bar).getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.queryByText(NUDGE_MESSAGE)).toBeNull();
    });
    expect(platform.downloads).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(() => {
      platform.clock.set(FIXED_NOW_MS + EXPORT_NUDGE_MS + 1);
      platform.visible();
    });
    expect(session.exportNudge.value).toBe(true);
    expect(await screen.findByText(NUDGE_MESSAGE)).toBeTruthy();
    fireEvent.click(
      within(must(screen.getByText(NUDGE_MESSAGE).parentElement)).getByRole('button', {
        name: 'Dismiss',
      }),
    );
    await waitFor(() => {
      expect(screen.queryByText(NUDGE_MESSAGE)).toBeNull();
    });
  });

  it('opens Settings with the copyable text when the nudge export cannot be saved', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { platform } = await mount({ repo });
    platform.downloadOk = false;
    fireEvent.click(
      within(must(screen.getByText(NUDGE_MESSAGE).parentElement)).getByRole('button', {
        name: 'Export',
      }),
    );
    const settings = await screen.findByRole('dialog', { name: 'Settings' });
    const area = within(settings).getByLabelText<HTMLTextAreaElement>(EXPORT_TEXT_LABEL);
    expect(area.readOnly).toBe(true);
    expect(JSON.parse(area.value)).toMatchObject({ schemaVersion: 1 });
    expect(screen.getByText(NUDGE_MESSAGE)).toBeTruthy();
    fireEvent.click(within(settings).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(within(settings).queryByLabelText(EXPORT_TEXT_LABEL)).toBeNull();
    });

    fireEvent.click(within(settings).getByRole('button', { name: 'Export' }));
    expect(await within(settings).findByLabelText(EXPORT_TEXT_LABEL)).toBeTruthy();
    fireEvent.click(within(settings).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', {
        name: 'Settings',
      }),
    );
    const reopened = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(reopened).queryByLabelText(EXPORT_TEXT_LABEL)).toBeNull();
  });

  it('shows an import rejection inline in Settings and keeps the board unchanged', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { session, router } = await mount({ repo });
    router.navigate({ kind: 'settings' });
    const settings = await screen.findByRole('dialog', { name: 'Settings' });
    const input = must(settings.querySelector<HTMLInputElement>('input[type="file"]'));
    const bad = new File(['{"schemaVersion":2}'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    await act(async () => {
      fireEvent.change(input);
      await Promise.resolve();
    });
    const alert = await within(settings).findByRole('alert');
    expect(alert.textContent).toBe('Import rejected: Unsupported schema version (expected 1)');
    expect(Object.keys(session.state.value.patients)).toEqual(['p-fresh']);
    fireEvent.click(within(settings).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(session.importError.value).toBeUndefined();
    expect(screen.getByText('Fixture Dog One')).toBeTruthy();
  });

  it('ignores a patient route for an unknown id and reopens on hash change', async () => {
    const repo = fakeRepo();
    repo.loadResult = { ...emptyLoad(), patients: [patientFresh()] };
    const { router } = await mount({ repo });
    router.navigate({ kind: 'patient', id: 'nope' });
    await act(() => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
    router.navigate({ kind: 'patient', id: 'p-fresh' });
    expect(await screen.findByRole('dialog', { name: 'Fixture Dog One' })).toBeTruthy();
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
  });
});
