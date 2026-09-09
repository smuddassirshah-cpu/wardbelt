// Decision notes: stage 7 evidence for the PLAN.md section 8 storage rows, driven through the
// real store (openRepo over fake-indexeddb or no IndexedDB at all) and the rendered App rather
// than the fake repo the stage 5 tests use. Three paths: no IndexedDB (private mode) boots in
// memory with the permanent banner and every action still works; an open that throws does the
// same with the browser's reason kept out of the banner; a write that fails twice shows the
// same banner while the action stays applied, and the next successful write clears it. The
// failures are genuine fake-indexeddb request errors, so retry, queue and flush run for real;
// four puts fail because ADD_PATIENT persists two writes (patient, then event) and the second
// write retries the queued first one before itself. Fixtures are synthetic.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRepo, type RepoOptions } from '../../../src/store/repo';
import { App } from '../../../src/ui/App';
import { STORAGE_UNAVAILABLE } from '../../../src/ui/app/notices';
import { createRouter } from '../../../src/ui/app/router';
import { createSession } from '../../../src/ui/app/session';
import { STORAGE_LINE } from '../../../src/ui/Settings';
import { fakePlatform } from '../app/helpers';
import { factoryThrowing, failNextPuts, freshFactory, quotaError } from '../store/helpers';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

async function mountWith(base: RepoOptions) {
  const platform = fakePlatform({
    openRepo: (options) => openRepo({ ...base, ...options, retryDelayMs: 0 }),
  });
  const session = createSession(platform);
  render(<App session={session} router={createRouter(window)} />);
  await act(async () => {
    await session.start();
  });
  return { platform, session };
}

async function addFromSheet(name: string): Promise<void> {
  const bar = screen.getByRole('navigation', { name: 'Main' });
  fireEvent.click(within(bar).getByRole('button', { name: 'Add patient' }));
  const sheet = await screen.findByRole('dialog', { name: 'Add patient' });
  fireEvent.input(within(sheet).getByLabelText('Name'), { target: { value: name } });
  fireEvent.input(within(sheet).getByLabelText('Procedure'), { target: { value: 'Dental' } });
  fireEvent.submit(must(sheet.querySelector('form')));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

function storageBanner(): HTMLElement | undefined {
  return screen
    .queryAllByRole('status')
    .find((el) => el.textContent.startsWith(STORAGE_UNAVAILABLE));
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('storage unavailable at boot', () => {
  it('boots in memory mode with the permanent banner and every action still works', async () => {
    const { session } = await mountWith({ indexedDB: undefined });
    expect(session.storageMode.value).toBe('memory');
    expect(must(storageBanner()).textContent).toBe(STORAGE_UNAVAILABLE);

    await addFromSheet('Fixture Omicron');
    expect(screen.getByText('Fixture Omicron')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Handover and admit' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete Bloods' })).toBeTruthy();
    });
    await session.flush();
    expect(storageBanner()).toBeDefined();
    expect(Object.keys(session.state.value.patients)).toHaveLength(1);

    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', {
        name: 'Settings',
      }),
    );
    const settings = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(settings).getByText(STORAGE_LINE.memory)).toBeTruthy();
  });

  it('falls back to memory with the banner when opening IndexedDB throws', async () => {
    const { session } = await mountWith({
      indexedDB: factoryThrowing(new DOMException('blocked by policy', 'SecurityError')),
    });
    expect(session.storageMode.value).toBe('memory');
    expect(must(storageBanner()).textContent).toBe(STORAGE_UNAVAILABLE);
    await addFromSheet('Fixture Pi');
    expect(screen.getByText('Fixture Pi')).toBeTruthy();
  });
});

describe('storage write failure after boot', () => {
  it('keeps the action, shows the banner after two failed writes and clears it on recovery', async () => {
    const { session } = await mountWith({ indexedDB: freshFactory(), dbName: 'wardbelt-h7' });
    expect(session.storageMode.value).toBe('idb');
    expect(storageBanner()).toBeUndefined();

    const puts = failNextPuts(4, quotaError());
    await addFromSheet('Fixture Rho');
    await act(async () => {
      await session.flush();
    });
    expect(screen.getByText('Fixture Rho')).toBeTruthy();
    await waitFor(() => {
      expect(storageBanner()).toBeDefined();
    });
    const banner = must(storageBanner());
    expect(banner.textContent).toContain(STORAGE_UNAVAILABLE);
    expect(banner.textContent).toContain('QuotaExceededError');
    expect(banner.textContent).not.toContain('Fixture Rho');
    expect(puts).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Handover and admit' }));
    await act(async () => {
      await session.flush();
    });
    await waitFor(() => {
      expect(storageBanner()).toBeUndefined();
    });
    expect(screen.getByRole('button', { name: 'Complete Bloods' })).toBeTruthy();
  });
});
