// Decision notes: helpers shared by the flow, shift and transfer specs. Every spec gets a
// fresh browser context, so IndexedDB is per test; `readStore` reads the raw object stores
// through the page so a spec can assert what actually landed on disk rather than what the
// board shows. Names are synthetic placeholders.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export const PRE_THEATRE = [
  'Handover and admit',
  'Bloods',
  'Draw up meds',
  'Premed',
  'To theatre',
  'In theatre',
];
export const CHECK_OFFSETS = [15, 30, 45, 60];

export interface RawStore {
  patients: Record<string, unknown>[];
  events: Record<string, unknown>[];
  settings: Record<string, unknown>[];
}

export function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

export function row(page: Page, name: string): Locator {
  return page.locator('article.row').filter({ has: page.locator('.row__name', { hasText: name }) });
}

export async function ready(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Wardbelt' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Add patient' })).toBeEnabled();
}

/** Adds a patient from the board and returns the number of taps it took (typing is not a tap). */
export async function addPatient(
  page: Page,
  name: string,
  procedure: string,
  options: { species?: string; intake?: string } = {},
): Promise<number> {
  let taps = 0;
  const tap = async (target: Locator): Promise<void> => {
    await target.click();
    taps += 1;
  };
  await tap(nav(page).getByRole('button', { name: 'Add patient' }));
  const sheet = page.getByRole('dialog', { name: 'Add patient' });
  await tap(sheet.getByLabel('Name', { exact: true }));
  await page.keyboard.type(name);
  await tap(sheet.getByLabel('Procedure', { exact: true }));
  await page.keyboard.type(procedure);
  if (options.species !== undefined) {
    await tap(sheet.getByText(options.species, { exact: true }));
  }
  if (options.intake !== undefined) {
    await tap(sheet.getByText(options.intake, { exact: true }));
  }
  await tap(sheet.getByRole('button', { name: 'Add patient' }));
  await expect(sheet).toBeHidden();
  await expect(row(page, name)).toBeVisible();
  return taps;
}

export async function completeCurrent(target: Locator, label: string): Promise<void> {
  await target.getByRole('button', { name: `Complete ${label}` }).click();
}

export async function completeThroughTheatre(page: Page, name: string): Promise<void> {
  for (const label of PRE_THEATRE) {
    await completeCurrent(row(page, name), label);
  }
}

export async function openSheet(page: Page, name: string): Promise<Locator> {
  await row(page, name)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet).toBeVisible();
  return sheet;
}

export function taskItem(sheet: Locator, label: string): Locator {
  return sheet
    .locator('li.task')
    .filter({ has: sheet.page().locator('.task__label', { hasText: label }) });
}

export async function openSettings(page: Page): Promise<Locator> {
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Settings' });
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
}

/** Discharges through the patient sheet's button, then closes the sheet. */
export async function dischargePatient(page: Page, name: string): Promise<void> {
  const sheet = await openSheet(page, name);
  await sheet.getByRole('button', { name: 'Discharge', exact: true }).click();
  await expect(sheet.getByRole('button', { name: /^Discharged \d\d:\d\d$/ })).toBeDisabled();
  await closeSheet(sheet);
}

/**
 * Raw contents of the three object stores, or empty lists before the database exists. The
 * existence check matters: a bare open() would create an empty version 1 database and the app
 * would then never run its own upgrade.
 */
export function readStore(page: Page): Promise<RawStore> {
  return page.evaluate(async () => {
    const out: RawStore = { patients: [], events: [], settings: [] };
    const known = await indexedDB.databases();
    if (!known.some((d) => d.name === 'wardbelt')) {
      return out;
    }
    const request = indexedDB.open('wardbelt');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('open failed'));
      };
    });
    const names = ['patients', 'events', 'settings'] as const;
    for (const name of names) {
      if (!db.objectStoreNames.contains(name)) {
        continue;
      }
      const all = db.transaction(name).objectStore(name).getAll();
      out[name] = await new Promise<Record<string, unknown>[]>((resolve) => {
        all.onsuccess = () => {
          resolve(all.result as Record<string, unknown>[]);
        };
      });
    }
    db.close();
    return out;
  });
}

/** Resolves once the stored records satisfy `check` (writes are asynchronous). */
export async function waitForStore(
  page: Page,
  check: (store: RawStore) => boolean,
): Promise<RawStore> {
  await expect.poll(async () => check(await readStore(page)), { timeout: 10_000 }).toBe(true);
  return readStore(page);
}

/** Resolves once IndexedDB holds a patient with this name. */
export async function waitForPersisted(page: Page, name: string): Promise<void> {
  await waitForStore(page, (s) => s.patients.some((p) => p.name === name));
}

export function localMinutes(value: string): number {
  const [, hh = '0', mm = '0'] = /T(\d\d):(\d\d)/.exec(value) ?? [];
  return Number(hh) * 60 + Number(mm);
}

export function clockText(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

/** Visible buttons, links and fields smaller than 48 px (radios measured through their label). */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const failures: string[] = [];
    const selector = 'button, a[href], input, select, textarea, [role="button"]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.hidden || el.getClientRects().length === 0 || el.closest('[inert]') !== null) {
        continue;
      }
      const boxed =
        el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
      const box = (boxed ? (el.closest('label') ?? el) : el).getBoundingClientRect();
      if (box.width < 48 || box.height < 48) {
        failures.push(`${el.tagName} ${el.getAttribute('aria-label') ?? el.innerText}`);
      }
    }
    return failures;
  });
}
