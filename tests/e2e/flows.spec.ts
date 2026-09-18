// Decision notes: the stage 5 DoD flows (PLAN.md section 11) on the production build with the
// Pixel 5 profile. Every test gets a fresh browser context (IndexedDB is per context) and the
// time-dependent ones install the Playwright clock before navigation so Date.now and the
// scheduler's setTimeout are both under test control; the clock keeps running in real time so
// Preact's effects still schedule, and fastForward jumps it. Names are synthetic placeholders.
import { expect, test } from '@playwright/test';
import {
  addPatient,
  axeViolations,
  bookDischarge,
  CHECK_OFFSETS,
  clockText,
  closeSheet,
  completeCurrent,
  completeThroughHandover,
  completeThroughTheatre,
  localMinutes,
  nav,
  openSheet,
  ready,
  row,
  smallTargets,
  taskItem,
  waitForPersisted,
} from './helpers';

test('adds a patient from the board in at most 8 taps', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByText('No patients on the board. Add one to start.')).toBeVisible();
  const taps = await addPatient(page, 'Fixture Alpha', 'Lump removal', {
    species: 'Cat',
    intake: '10:00',
  });
  expect(taps).toBeLessThanOrEqual(8);
  const added = row(page, 'Fixture Alpha');
  await expect(added.locator('.row__name')).toHaveText('Fixture Alpha');
  await expect(added.locator('.row__species')).toHaveText('Cat');
  await expect(added.getByRole('group')).toHaveAttribute(
    'aria-label',
    '0 of 18 done, current: Handover and admit',
  );
  await expect(added.locator('.belt__square')).toHaveCount(18);
  await expect(added.locator('.belt__square svg[data-icon="handover_admit"]')).toHaveCount(1);
  await expect(added.locator('.row__meta > .chip')).toHaveText('Status Waiting');
  await expect(added.getByText('10:00')).toBeVisible();
});

test('completes steps by tapping the current cell', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Beta', 'Dental');
  const target = row(page, 'Fixture Beta');
  await completeCurrent(target, 'Handover and admit');
  await completeCurrent(target, 'Bloods');
  await completeCurrent(target, 'Draw up meds');
  await expect(target.locator('.belt__square--done')).toHaveCount(3);
  await expect(target.getByRole('button', { name: 'Complete Premed' })).toBeVisible();
  await expect(target.getByRole('group')).toHaveAttribute(
    'aria-label',
    '3 of 18 done, current: Premed',
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'Draw up meds completed' }),
  ).toBeVisible();
});

test('the four checks are scheduled by the handover, not by in theatre', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Gamma', 'Spay');
  await completeThroughTheatre(page, 'Fixture Gamma');
  const target = row(page, 'Fixture Gamma');
  await expect(target.locator('.chip--warning')).toHaveCount(0);
  await expect(target.locator('.row__meta > .chip')).toHaveText('Status In theatre');
  const waiting = await openSheet(page, 'Fixture Gamma');
  await expect(waiting.getByLabel('Back from theatre at')).toHaveValue('');
  for (let i = 1; i <= 4; i += 1) {
    await expect(taskItem(waiting, `Post-op check ${i}`).locator('.task__meta')).toContainText(
      'To do',
    );
  }
  await closeSheet(waiting);

  await page.clock.fastForward(5 * 60_000);
  await completeCurrent(target, 'Handover from theatre');
  await expect(target.locator('.chip--warning')).toHaveText(/\sin 15:00$/);
  await expect(target.locator('.chip--warning .visually-hidden')).toHaveText('Post-op check 1');
  await expect(target.locator('.chip--warning svg[data-icon="check_1"]')).toHaveCount(1);
  await expect(target.locator('.row__meta > .chip')).toHaveText('Status Recovery');

  const sheet = await openSheet(page, 'Fixture Gamma');
  const returned = await sheet.getByLabel('Back from theatre at').inputValue();
  expect(returned).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  const base = localMinutes(returned);
  for (const [i, offset] of CHECK_OFFSETS.entries()) {
    await expect(taskItem(sheet, `Post-op check ${i + 1}`).locator('.task__meta')).toContainText(
      `Due ${clockText(base + offset)}`,
    );
  }
});

test('an overdue check moves the row to the top under a fake clock', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Delta', 'Castrate');
  await addPatient(page, 'Fixture Epsilon', 'Lump removal');
  await completeThroughHandover(page, 'Fixture Epsilon');
  await expect(page.locator('.row__name')).toHaveText(['Fixture Delta', 'Fixture Epsilon']);

  await page.clock.fastForward(16 * 60_000);
  const late = row(page, 'Fixture Epsilon');
  await expect(late.locator('.chip--danger')).toHaveText(/\soverdue 01:0\d$/);
  await expect(late.locator('.chip--danger .visually-hidden')).toHaveText('Post-op check 1');
  await expect(late.locator('.chip--danger svg[data-icon="check_1"]')).toHaveCount(1);
  await expect(late).toHaveAttribute('data-urgency', 'overdue');
  await expect(late.locator('.belt__square--overdue')).toHaveCount(1);
  await expect(page.locator('.row__name')).toHaveText(['Fixture Epsilon', 'Fixture Delta']);
});

test('adds a custom task from the sheet after the chosen task', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Zeta', 'Dental');
  const sheet = await openSheet(page, 'Fixture Zeta');
  const due = await page.evaluate(() => {
    const d = new Date(Date.now() + 20 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  await sheet.getByLabel('Task label').fill('Bandage check');
  await sheet.getByLabel('Due time (optional)').fill(due);
  await sheet.getByLabel('Insert after').selectOption({ label: 'Premed' });
  await sheet.getByRole('button', { name: 'Add task' }).click();

  const items = sheet.locator('li.task');
  await expect(items).toHaveCount(19);
  await expect(items.nth(3).locator('.task__label')).toHaveText('Premed');
  await expect(items.nth(4).locator('.task__label')).toHaveText('Bandage check');
  await expect(items.nth(4).locator('.belt__square')).toHaveText('BA');
  await expect(items.nth(4).locator('.task__meta')).toContainText('Custom');
  await expect(items.nth(4).locator('.task__meta')).toContainText(`Due ${due.slice(11)}`);
  await sheet.getByRole('button', { name: 'Close' }).click();
  const cells = row(page, 'Fixture Zeta').locator('.belt__square');
  await expect(cells).toHaveCount(19);
  await expect(cells.nth(3).locator('svg')).toHaveAttribute('data-icon', 'premed');
  await expect(cells.nth(4)).toHaveText('BA');
});

test('skips a task, undoes from the toast and from the sheet', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Eta', 'Spay');
  const sheet = await openSheet(page, 'Fixture Eta');
  const bloods = taskItem(sheet, 'Bloods');
  await bloods.getByRole('button', { name: 'Skip Bloods' }).click();
  await expect(bloods.locator('.belt__square--skipped')).toHaveCount(1);
  await expect(bloods.locator('.task__meta')).toContainText('Skipped');

  const toast = page.getByRole('status').filter({ hasText: 'Bloods skipped' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(bloods.locator('.belt__square--skipped')).toHaveCount(0);
  await expect(bloods.getByRole('button', { name: 'Skip Bloods' })).toBeVisible();
  await expect(toast).toBeHidden();

  await bloods.getByRole('button', { name: 'Skip Bloods' }).click();
  await expect(bloods.locator('.belt__square--skipped')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(bloods.locator('.belt__square--skipped')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(row(page, 'Fixture Eta').locator('.belt__square--skipped')).toHaveCount(0);
});

test('books a collection time, clears it, rebooks it and then discharges', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Sigma', 'Dental');
  const target = row(page, 'Fixture Sigma');
  await expect(target.locator('.row__side .chip')).toHaveCount(0);

  await bookDischarge(page, 'Fixture Sigma', '15:30');
  await expect(
    page.getByRole('status').filter({ hasText: 'Discharge booked for 15:30' }),
  ).toBeVisible();
  const home = target.locator('.row__side .chip', { hasText: 'Home 15:30' });
  await expect(home).toBeVisible();
  await expect(home).not.toHaveClass(/chip--warning/);

  const sheet = await openSheet(page, 'Fixture Sigma');
  await sheet.getByRole('button', { name: 'Book discharge' }).click();
  await expect(sheet.getByLabel('Collection time')).toHaveValue('15:30');
  await sheet.getByRole('button', { name: 'Clear booking' }).click();
  await expect(sheet.getByText('Booked for 15:30')).toBeHidden();
  await closeSheet(sheet);
  await expect(target.locator('.row__side .chip')).toHaveCount(0);

  await bookDischarge(page, 'Fixture Sigma', '09:30');
  await expect(target.locator('.chip--warning', { hasText: 'Home 09:30' })).toBeVisible();
  await expect(target.getByRole('button', { name: /^Complete / })).toBeVisible();

  const last = await openSheet(page, 'Fixture Sigma');
  await last.getByRole('button', { name: 'Discharge', exact: true }).click();
  await expect(last.getByRole('button', { name: /^Discharged \d\d:\d\d$/ })).toBeDisabled();
  await expect(last.getByText('Booked for 09:30')).toBeVisible();
  await expect(last.getByRole('button', { name: 'Book discharge' })).toHaveCount(0);
  await closeSheet(last);

  await expect(row(page, 'Fixture Sigma')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show discharged (1)' }).click();
  const discharged = row(page, 'Fixture Sigma');
  await expect(discharged).toBeVisible();
  await expect(discharged.locator('.row__side .chip')).toHaveCount(0);
  await expect(discharged.locator('.row__meta > .chip')).toHaveCount(0);
});

test('discharging moves the row under Show discharged', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Theta', 'Dental');
  const sheet = await openSheet(page, 'Fixture Theta');
  await sheet.getByRole('button', { name: 'Discharge', exact: true }).click();
  await expect(sheet.getByRole('button', { name: /^Discharged \d\d:\d\d$/ })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Close' }).click();

  await expect(row(page, 'Fixture Theta')).toHaveCount(0);
  await expect(page.getByText('No patients on the board. Add one to start.')).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Show discharged (1)' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Hide discharged (1)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const discharged = row(page, 'Fixture Theta');
  await expect(discharged).toBeVisible();
  await expect(discharged.getByRole('button', { name: /^Complete / })).toHaveCount(0);
  await expect(discharged.getByRole('group')).toHaveAttribute('aria-label', /nothing left to do/);
});

test('reloads offline from the service worker with data intact', async ({ page, context }) => {
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Iota', 'Lump removal');
  await waitForPersisted(page, 'Fixture Iota');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(row(page, 'Fixture Iota')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await expect(row(page, 'Fixture Iota')).toBeVisible();
  await expect(row(page, 'Fixture Iota').getByRole('group')).toHaveAttribute(
    'aria-label',
    '0 of 18 done, current: Handover and admit',
  );
  await context.setOffline(false);
});

test('a second tab is read-only until the first closes', async ({ page, context }) => {
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Kappa', 'Spay');

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Wardbelt' })).toBeVisible();
  const banner = second.getByRole('status').filter({ hasText: 'Wardbelt is open in another tab' });
  await expect(banner).toBeVisible();
  await expect(nav(second).getByRole('button', { name: 'Add patient' })).toBeDisabled();
  await expect(row(second, 'Fixture Kappa')).toBeVisible();
  await expect(
    row(second, 'Fixture Kappa').getByRole('button', { name: /^Complete / }),
  ).toBeDisabled();
  await expect(nav(page).getByRole('button', { name: 'Add patient' })).toBeEnabled();

  await page.close();
  await second.reload();
  await ready(second);
  await expect(
    second.getByRole('status').filter({ hasText: 'Wardbelt is open in another tab' }),
  ).toHaveCount(0);
  await expect(row(second, 'Fixture Kappa')).toBeVisible();
  await expect(
    row(second, 'Fixture Kappa').getByRole('button', { name: /^Complete / }),
  ).toBeEnabled();
});

test('board and add sheet are axe clean with 48 px targets', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  expect(await axeViolations(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await addPatient(page, 'Fixture Mu', 'Dental', { intake: '08:00' });
  await completeCurrent(row(page, 'Fixture Mu'), 'Handover and admit');
  expect(await axeViolations(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await expect(row(page, 'Fixture Mu')).toHaveCSS('height', '88px');

  await nav(page).getByRole('button', { name: 'Add patient' }).click();
  await expect(page.getByRole('dialog', { name: 'Add patient' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  await page
    .getByRole('dialog', { name: 'Add patient' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await openSheet(page, 'Fixture Mu');
  expect(await axeViolations(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
});
