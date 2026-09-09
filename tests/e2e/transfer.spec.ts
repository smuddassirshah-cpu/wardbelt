// Decision notes: the stage 6 transfer DoD (PLAN.md section 11): export, wipe, import back
// to identical state, a rejected malformed file, and auto-purge at boot honouring the purge
// days setting. Web Share is switched off through an init script so the export takes the
// `<a download>` path Playwright can capture (headless Chromium has no share sheet, and Linux
// builds have no navigator.share at all); the share path is unit-tested. Raw IndexedDB is read
// through the page so the assertions cover what landed on disk. Names are synthetic.
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  addPatient,
  axeViolations,
  closeSheet,
  completeCurrent,
  dischargePatient,
  openSettings,
  openSheet,
  ready,
  readStore,
  row,
  smallTargets,
  taskItem,
  waitForStore,
  type RawStore,
} from './helpers';

const DAY = 24 * 60 * 60_000;
const EMPTY = 'No patients on the board. Add one to start.';
const NUDGE = 'No export in the last 7 days. Back up your data.';

interface BeltSnapshot {
  label: string | null;
  cells: string[];
}

interface ExportFile {
  schemaVersion: number;
  exportedAt: string;
  patients: { id: string; name: string }[];
  events: { id: string }[];
  settings: Record<string, unknown>;
}

function byId<T extends { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.id.localeCompare(b.id));
}

/** Belt state per row on the board, keyed by patient name. */
function belts(page: Page): Promise<Record<string, BeltSnapshot>> {
  return page.$$eval('article.row', (rows) =>
    Object.fromEntries(
      rows.map((r) => [
        r.querySelector('.row__name')?.textContent ?? '',
        {
          label: r.querySelector('[role="group"]')?.getAttribute('aria-label') ?? null,
          cells: Array.from(r.querySelectorAll('.belt__square')).map(
            (c) => `${c.className}:${c.textContent}`,
          ),
        },
      ]),
    ),
  );
}

function settingsOf(store: RawStore): Record<string, unknown> {
  return Object.fromEntries(store.settings.map((r) => [String(r.key), r.value]));
}

async function importFile(page: Page, path: string): Promise<void> {
  const settings = await openSettings(page);
  await settings.locator('input[type="file"]').setInputFiles(path);
}

test('exports, wipes, and imports back to identical state; rejects a malformed file', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: () => false,
      configurable: true,
    });
  });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Delta', 'Spay', { species: 'Cat', intake: '08:00' });
  await addPatient(page, 'Fixture Epsilon', 'Dental');
  await completeCurrent(row(page, 'Fixture Delta'), 'Handover and admit');
  await completeCurrent(row(page, 'Fixture Delta'), 'Bloods');
  const sheet = await openSheet(page, 'Fixture Epsilon');
  await taskItem(sheet, 'Bloods').getByRole('button', { name: 'Skip Bloods' }).click();
  await closeSheet(sheet);
  const before = await belts(page);
  expect(Object.keys(before).sort()).toEqual(['Fixture Delta', 'Fixture Epsilon']);
  expect(before['Fixture Delta']?.label).toBe('2 of 19 done, current: Draw up meds');
  await waitForStore(page, (s) => s.patients.length === 2 && s.events.length === 5);

  const settings = await openSettings(page);
  await expect(settings.getByText('Never exported.')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    settings.getByRole('button', { name: 'Export' }).click(),
  ]);
  const expectedName = await page.evaluate(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `wardbelt-export-${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  });
  expect(download.suggestedFilename()).toBe(expectedName);
  const path = await download.path();
  const text = await readFile(path, 'utf8');
  const file = JSON.parse(text) as ExportFile;
  expect(file.schemaVersion).toBe(1);
  expect(file.patients.map((p) => p.name).sort()).toEqual(['Fixture Delta', 'Fixture Epsilon']);
  expect(file.events).toHaveLength(5);
  await expect(page.getByRole('status').filter({ hasText: 'Exported' })).toBeVisible();
  await expect(settings.getByText(/^Last export /)).toBeVisible();
  await waitForStore(page, (s) => s.settings.some((r) => r.key === 'lastExportAt'));

  await settings.getByRole('button', { name: 'Delete everything' }).click();
  await settings.getByRole('button', { name: 'Confirm delete everything' }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByText(EMPTY)).toBeVisible();
  await waitForStore(page, (s) => s.patients.length === 0 && s.events.length === 0);
  await page.reload();
  await ready(page);
  await expect(page.getByText(EMPTY)).toBeVisible();
  expect(await readStore(page)).toEqual({ patients: [], events: [], settings: [] });

  await importFile(page, path);
  await expect(page.getByRole('status').filter({ hasText: 'Imported 2 patients' })).toBeVisible();
  await closeSheet(page.getByRole('dialog', { name: 'Settings' }));
  await expect(row(page, 'Fixture Delta')).toBeVisible();
  await expect(row(page, 'Fixture Epsilon')).toBeVisible();
  expect(await belts(page)).toEqual(before);
  const restored = await waitForStore(
    page,
    (s) => s.patients.length === 2 && s.events.length === 5 && s.settings.length > 0,
  );
  expect(byId(restored.patients as ExportFile['patients'])).toEqual(byId(file.patients));
  expect(byId(restored.events as ExportFile['events'])).toEqual(byId(file.events));
  expect(settingsOf(restored)).toEqual(file.settings);

  const broken: ExportFile = { ...file, patients: file.patients.map((p) => ({ ...p })) };
  const target = broken.patients[0];
  if (target !== undefined) {
    target.name = '';
  }
  const badPath = test.info().outputPath('broken.json');
  await writeFile(badPath, JSON.stringify(broken));
  await importFile(page, badPath);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('alert')).toHaveText('Import rejected: 1 record failed validation');
  const junkPath = test.info().outputPath('junk.json');
  await writeFile(junkPath, 'not json at all');
  await dialog.locator('input[type="file"]').setInputFiles(junkPath);
  await expect(dialog.getByRole('alert')).toHaveText('Import rejected: File is not valid JSON');
  await closeSheet(dialog);
  expect(await belts(page)).toEqual(before);
  const untouched = await readStore(page);
  expect(byId(untouched.patients as ExportFile['patients'])).toEqual(byId(file.patients));
  expect(untouched.events).toHaveLength(5);
});

test('auto-purge at boot removes discharged patients older than the purge days setting', async ({
  page,
}) => {
  const start = new Date(2026, 2, 10, 10, 0, 0);
  await page.clock.install({ time: start });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Zeta', 'Spay');
  await dischargePatient(page, 'Fixture Zeta');
  await expect(page.getByRole('button', { name: 'Show discharged (1)' })).toBeVisible();

  const setPurgeDays = async (days: number): Promise<void> => {
    const settings = await openSettings(page);
    const input = settings.getByLabel('Keep discharged patients for (days)');
    await input.fill(String(days));
    await input.blur();
    await expect(
      settings.getByRole('button', {
        name: new RegExp(`^Purge discharged older than ${String(days)} days?$`),
      }),
    ).toBeVisible();
    await closeSheet(settings);
    await waitForStore(page, (s) =>
      s.settings.some((r) => r.key === 'purgeDays' && r.value === days),
    );
  };

  await setPurgeDays(1);
  await waitForStore(page, (s) => s.patients.some((p) => p.status === 'discharged'));
  await page.clock.setSystemTime(new Date(start.getTime() + 2 * DAY));
  await page.reload();
  await ready(page);
  await expect(page.getByText(EMPTY)).toBeVisible();
  await expect(page.getByRole('button', { name: /discharged \(/ })).toHaveCount(0);
  await waitForStore(page, (s) => s.patients.length === 0);
  expect((await readStore(page)).events).toEqual([]);

  await addPatient(page, 'Fixture Eta', 'Dental');
  await dischargePatient(page, 'Fixture Eta');
  await setPurgeDays(5);
  await waitForStore(page, (s) => s.patients.some((p) => p.status === 'discharged'));
  await page.clock.setSystemTime(new Date(start.getTime() + 4 * DAY));
  await page.reload();
  await ready(page);
  await expect(page.getByRole('button', { name: 'Show discharged (1)' })).toBeVisible();
  const kept = await readStore(page);
  expect(kept.patients.map((p) => p.name)).toEqual(['Fixture Eta']);
});

test('settings persist across reload and the weekly export nudge appears until exported', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: () => false,
      configurable: true,
    });
  });
  await page.goto('/');
  await ready(page);
  await expect(page.getByText(NUDGE)).toHaveCount(0);
  await addPatient(page, 'Fixture Theta', 'Spay');
  const nudge = page.getByRole('status').filter({ hasText: NUDGE });
  await expect(nudge).toBeVisible();
  await nudge.getByRole('button', { name: 'Dismiss' }).click();
  await expect(nudge).toHaveCount(0);

  const settings = await openSettings(page);
  const notifications = settings.getByRole('checkbox', { name: /Notifications/ });
  const hint = settings.getByText(/^(Allowed|Blocked|Not supported|The browser will ask)/);
  await expect(hint).toBeVisible();
  const blocked = /^(Blocked|Not supported)/.test(await hint.innerText());
  if (blocked) {
    await expect(notifications).toBeDisabled();
  } else {
    await notifications.check();
  }
  await settings.getByRole('checkbox', { name: /Click on completion/ }).check();
  await settings.getByRole('checkbox', { name: /Show owner phone field/ }).check();
  await settings.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const days = settings.getByLabel('Keep discharged patients for (days)');
  await days.fill('14');
  await days.blur();
  await closeSheet(settings);
  await waitForStore(
    page,
    (s) =>
      s.settings.some((r) => r.key === 'purgeDays' && r.value === 14) &&
      s.settings.some((r) => r.key === 'theme' && r.value === 'dark') &&
      s.settings.some((r) => r.key === 'sound' && r.value === true) &&
      s.settings.some((r) => r.key === 'showOwnerPhone' && r.value === true) &&
      s.settings.some((r) => r.key === 'notifications' && r.value === !blocked),
  );

  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(nudge).toBeVisible();
  const reopened = await openSettings(page);
  if (!blocked) {
    await expect(reopened.getByRole('checkbox', { name: /Notifications/ })).toBeChecked();
  }
  await expect(reopened.getByRole('checkbox', { name: /Click on completion/ })).toBeChecked();
  await expect(reopened.getByRole('checkbox', { name: /Show owner phone field/ })).toBeChecked();
  await expect(reopened.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(reopened.getByLabel('Keep discharged patients for (days)')).toHaveValue('14');
  await expect(
    reopened.getByRole('button', { name: 'Purge discharged older than 14 days' }),
  ).toBeVisible();
  await closeSheet(reopened);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Add patient' })
    .click();
  const add = page.getByRole('dialog', { name: 'Add patient' });
  await expect(add.getByLabel('Owner phone')).toBeVisible();
  await add.getByRole('button', { name: 'Cancel' }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    nudge.getByRole('button', { name: 'Export' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^wardbelt-export-\d{4}-\d\d-\d\d\.json$/);
  await expect(nudge).toHaveCount(0);
  await waitForStore(page, (s) => s.settings.some((r) => r.key === 'lastExportAt'));
  await page.reload();
  await ready(page);
  await expect(row(page, 'Fixture Theta')).toBeVisible();
  await expect(page.getByText(NUDGE)).toHaveCount(0);
});

test('falls back to a copyable textarea when the download cannot be created', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', {
      value: () => false,
      configurable: true,
    });
    URL.createObjectURL = () => {
      throw new Error('object URLs blocked');
    };
  });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Iota', 'Dental');
  const settings = await openSettings(page);
  await settings.getByRole('button', { name: 'Export' }).click();
  const area = settings.getByLabel('The file could not be saved. Copy this text instead');
  await expect(area).toBeVisible();
  await expect(area).toHaveAttribute('readonly', '');
  const exported = JSON.parse(await area.inputValue()) as ExportFile;
  expect(exported.patients.map((p) => p.name)).toEqual(['Fixture Iota']);
  await expect(settings.getByText('Never exported.')).toBeVisible();
  await area.focus();
  expect(
    await area.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart),
  ).toBe((await area.inputValue()).length);

  const junkPath = test.info().outputPath('junk.json');
  await writeFile(junkPath, '[]');
  await settings.locator('input[type="file"]').setInputFiles(junkPath);
  await expect(settings.getByRole('alert')).toHaveText(
    'Import rejected: File is not a Wardbelt export',
  );
  expect(await axeViolations(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);

  await settings.getByRole('button', { name: 'Done' }).click();
  await expect(area).toHaveCount(0);
  await closeSheet(settings);
  await expect(page.getByRole('status').filter({ hasText: NUDGE })).toBeVisible();
});
