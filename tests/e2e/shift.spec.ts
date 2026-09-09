// Decision notes: the stage 6 stats DoD (PLAN.md section 11) on the production build with
// the Pixel 5 profile. The Playwright clock is installed inside a shift and fast-forwarded
// between the four post-op checks so their on-time or late status is fixed by construction:
// check 1 at +14 (due +15), check 2 at +31 (due +30, inside the 3-minute grace), check 3 at
// +49 (due +45, past grace) and check 4 at +60 (due +60). The median admit-to-discharge time
// is computed from the timestamps the app actually stored, because seconds of real time pass
// between fast-forwards. Names are synthetic placeholders.
import { expect, test, type Page } from '@playwright/test';
import {
  addPatient,
  completeCurrent,
  completeThroughTheatre,
  closeSheet,
  dischargePatient,
  nav,
  openSheet,
  ready,
  row,
  taskItem,
  waitForStore,
} from './helpers';

const A = 'Fixture Alpha';
const B = 'Fixture Beta';
const C = 'Fixture Gamma';
const MINUTE = 60_000;

/** Mirrors src/ui/format.ts formatMinutes. */
function formatMinutes(min: number): string {
  const whole = Math.round(min);
  return whole < 60 ? `${whole} min` : `${Math.floor(whole / 60)} h ${whole % 60} min`;
}

async function summaryValues(page: Page): Promise<string[]> {
  const dialog = page.getByRole('dialog', { name: 'Shift summary' });
  await expect(dialog).toBeVisible();
  return dialog.locator('dd').allTextContents();
}

test('a scripted shift produces the expected stats, then resets after 04:00', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);
  await addPatient(page, A, 'Spay', { intake: '08:00' });
  await addPatient(page, B, 'Dental', { intake: '09:00' });
  await addPatient(page, C, 'Lump removal', { intake: '10:00' });

  await completeThroughTheatre(page, A);
  await expect(row(page, A).locator('.chip--warning')).toHaveText(/C1 in 15:00/);

  await page.clock.fastForward(14 * MINUTE);
  const sheetA = await openSheet(page, A);
  await taskItem(sheetA, 'Handover from theatre')
    .getByRole('button', { name: 'Skip Handover from theatre' })
    .click();
  await closeSheet(sheetA);
  await completeCurrent(row(page, A), 'Post-op check 1');

  await page.clock.fastForward(17 * MINUTE);
  await completeCurrent(row(page, A), 'Post-op check 2');

  await page.clock.fastForward(18 * MINUTE);
  await expect(row(page, A).locator('.chip--danger')).toHaveText(/C3 overdue 04:\d\d/);
  await completeCurrent(row(page, A), 'Post-op check 3');

  await page.clock.fastForward(11 * MINUTE);
  await completeCurrent(row(page, A), 'Post-op check 4');

  const sheetB = await openSheet(page, B);
  await taskItem(sheetB, 'Bloods').getByRole('button', { name: 'Skip Bloods' }).click();
  await closeSheet(sheetB);

  await dischargePatient(page, A);
  await dischargePatient(page, B);
  await expect(row(page, C)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show discharged (2)' })).toBeVisible();

  const store = await waitForStore(
    page,
    (s) => s.patients.filter((p) => p.status === 'discharged').length === 2,
  );
  const durations = store.patients
    .filter((p) => p.status === 'discharged')
    .map((p) => (Date.parse(String(p.dischargedAt)) - Date.parse(String(p.createdAt))) / MINUTE)
    .sort((x, y) => x - y);
  expect(durations).toHaveLength(2);
  const [first = 0, second = 0] = durations;
  const median = (first + second) / 2;
  expect(median).toBeGreaterThanOrEqual(60);
  expect(median).toBeLessThan(65);

  await nav(page).getByRole('button', { name: 'Summary' }).click();
  const summary = page.getByRole('dialog', { name: 'Shift summary' });
  await expect(summary.getByText('Shift from 04:00 Tue 10 Mar')).toBeVisible();
  await expect(summary.locator('dt')).toHaveText([
    'Tasks completed',
    'Tasks skipped',
    'Checks on time',
    'Best on-time streak',
    'Patients admitted',
    'Patients discharged',
    'Median admit to discharge',
  ]);
  expect(await summaryValues(page)).toEqual([
    '12',
    '2',
    '75%',
    '2',
    '3',
    '2',
    formatMinutes(median),
  ]);

  await page.clock.fastForward(18 * 60 * MINUTE);
  await expect(summary.getByText('Shift from 04:00 Wed 11 Mar')).toBeVisible();
  expect(await summaryValues(page)).toEqual(['0', '0', 'n/a', '0', '0', '0', 'n/a']);
  await closeSheet(summary);
  await expect(row(page, C)).toBeVisible();
});
