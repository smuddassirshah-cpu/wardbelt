// Decision notes: the README screenshots are taken from the production build on the Pixel 5
// profile under the Playwright clock (10:00 local, Tue 10 Mar 2026) so the header clock, the
// due times and the shift label are the same on every run. The board is seeded through the
// real Add sheet with synthetic names only: a dog back from theatre with post-op check 1 done
// on time and check 2 overdue (danger chip, pulsing cell, sorted first), a cat in pre-op with a done and a skipped
// cell and a 10:00 intake chip, a fresh rabbit, and a discharged fourth patient shown through
// the board's toggle. The PNGs land in docs/screenshots/ only when WARDBELT_EVIDENCE is set
// (the same switch as the axe evidence), so an ordinary e2e run never rewrites a tracked file;
// otherwise they go to the Playwright output directory and are attached to the report. Each
// file is asserted under 300 kB because they are committed. `animations: 'disabled'` settles
// the overdue pulse and the sheet slide so the pixels are stable.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addPatient,
  closeSheet,
  completeCurrent,
  completeThroughTheatre,
  dischargePatient,
  nav,
  openSheet,
  ready,
  row,
  taskItem,
} from './helpers';

const SCREENSHOT_DIR = resolve('docs', 'screenshots');
const MAX_BYTES = 300_000;
const LIGHT_BG = 'rgb(250, 250, 249)';
const DARK_BG = 'rgb(18, 18, 18)';
const NUDGE = 'No export in the last 7 days. Back up your data.';

test.setTimeout(90_000);

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  const evidence = process.env.WARDBELT_EVIDENCE !== undefined;
  if (evidence) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const path = evidence ? resolve(SCREENSHOT_DIR, `${name}.png`) : info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  const bytes = statSync(path).size;
  expect(bytes, `${name}.png is ${String(bytes)} bytes`).toBeLessThan(MAX_BYTES);
  await info.attach(name, { path, contentType: 'image/png' });
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** Seeds the four patients and leaves the board showing every state, nudge dismissed. */
async function seedBoard(page: Page): Promise<void> {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);

  await addPatient(page, 'Fixture Dog One', 'Lump removal', { intake: '08:00' });
  await completeThroughTheatre(page, 'Fixture Dog One');

  await addPatient(page, 'Fixture Cat Two', 'Dental', { species: 'Cat', intake: '10:00' });
  await completeCurrent(row(page, 'Fixture Cat Two'), 'Handover and admit');
  const cat = await openSheet(page, 'Fixture Cat Two');
  await taskItem(cat, 'Bloods').getByRole('button', { name: 'Skip Bloods' }).click();
  await expect(taskItem(cat, 'Bloods').locator('.belt__square--skipped')).toHaveCount(1);
  await closeSheet(cat);

  await addPatient(page, 'Fixture Rabbit Three', 'Castrate', { species: 'Rabbit' });
  await addPatient(page, 'Fixture Other Four', 'Wound check', { species: 'Other' });
  await dischargePatient(page, 'Fixture Other Four');

  await page.clock.fastForward(14 * 60_000);
  const late = row(page, 'Fixture Dog One');
  await completeCurrent(late, 'Handover from theatre');
  await completeCurrent(late, 'Post-op check 1');
  await expect(late.locator('.chip--warning')).toHaveText(/C2 in/);

  await page.clock.fastForward(17 * 60_000);
  await expect(late.locator('.chip--danger')).toHaveText(/C2 overdue/);
  await expect(late).toHaveAttribute('data-urgency', 'overdue');
  await expect(page.locator('.row__name').first()).toHaveText('Fixture Dog One');
  await expect(page.getByRole('status').filter({ hasText: /completed|skipped/ })).toHaveCount(0);

  const nudge = page.getByRole('status').filter({ hasText: NUDGE });
  await nudge.getByRole('button', { name: 'Dismiss' }).click();
  await expect(nudge).toBeHidden();

  await page.getByRole('button', { name: 'Show discharged (1)' }).click();
  await expect(row(page, 'Fixture Other Four')).toBeVisible();
  await expect(page.locator('article.row')).toHaveCount(4);
}

test('README screenshots: board, sheets, summary, settings and dark board', async ({
  page,
}, info) => {
  await seedBoard(page);
  expect(await bodyBackground(page)).toBe(LIGHT_BG);
  await capture(page, info, 'board-light');

  const sheet = await openSheet(page, 'Fixture Dog One');
  await expect(taskItem(sheet, 'Post-op check 1').locator('.task__meta')).toContainText('Done');
  await expect(taskItem(sheet, 'Post-op check 2').locator('.task__meta')).toContainText('Due');
  await taskItem(sheet, 'In theatre').evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
  await expect(taskItem(sheet, 'Post-op check 4')).toBeInViewport();
  await capture(page, info, 'patient-sheet');
  await closeSheet(sheet);

  await nav(page).getByRole('button', { name: 'Add patient' }).click();
  const add = page.getByRole('dialog', { name: 'Add patient' });
  await expect(add).toBeVisible();
  await capture(page, info, 'add-patient');
  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toBeHidden();

  await nav(page).getByRole('button', { name: 'Summary' }).click();
  const summary = page.getByRole('dialog', { name: 'Shift summary' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText('Shift from 04:00 Tue 10 Mar')).toBeVisible();
  await expect(summary.locator('.stats__value')).toHaveText([
    '10',
    '1',
    '100%',
    '1',
    '4',
    '1',
    /min$/,
  ]);
  await capture(page, info, 'summary');
  await closeSheet(summary);

  await nav(page).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await capture(page, info, 'settings');
  await closeSheet(settings);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);
  await expect(row(page, 'Fixture Dog One').locator('.chip--danger')).toHaveText(/C2 overdue/);
  await capture(page, info, 'board-dark');
});
