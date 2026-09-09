// Decision notes: the stage 4 DoD on the production build (PLAN.md section 11): axe clean in
// both themes, every visible target at least 48 px, reduced motion honoured, no horizontal
// page scroll. Radio and checkbox inputs are measured through their wrapping label, and the
// hidden file input is excluded because its 48 px Import button is the target. Body background
// is polled because the gallery applies data-theme in an effect that Preact flushes after paint.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const GALLERY = '/#/dev';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];
const LIGHT_BG = 'rgb(250, 250, 249)';
const DARK_BG = 'rgb(18, 18, 18)';

async function openGallery(page: Page, url = GALLERY): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Wardbelt gallery' })).toBeVisible();
  await expect(page.locator('#chips')).toBeVisible();
}

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
}

interface TargetFailure {
  tag: string;
  text: string;
  width: number;
  height: number;
}

async function smallTargets(page: Page): Promise<{ measured: number; failures: TargetFailure[] }> {
  return page.evaluate(() => {
    const MIN = 48;
    const selector = 'button, a[href], input, select, textarea, [role="button"]';
    const failures: TargetFailure[] = [];
    let measured = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.hidden || el.getClientRects().length === 0) {
        continue;
      }
      measured += 1;
      const isBoxed =
        el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
      const target = isBoxed ? (el.closest('label') ?? el) : el;
      const box = target.getBoundingClientRect();
      if (box.width < MIN || box.height < MIN) {
        failures.push({
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute('aria-label') ?? el.innerText).trim().slice(0, 40),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
    }
    return { measured, failures };
  });
}

test('light theme: axe clean, light background', async ({ page }) => {
  await openGallery(page);
  await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG);
  expect(await axeViolations(page)).toEqual([]);
});

test('dark theme via ?theme=dark: axe clean, dark background', async ({ page }) => {
  await openGallery(page, '/?theme=dark#/dev');
  await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);
  await expect(page.getByRole('button', { name: 'Dark', pressed: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('dark theme via prefers-color-scheme: axe clean, dark background', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openGallery(page);
  await expect.poll(() => bodyBackground(page)).toBe(DARK_BG);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Light' }).click();
  await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BG);
});

test('every visible interactive element is at least 48 by 48', async ({ page }) => {
  await openGallery(page);
  const result = await smallTargets(page);
  expect(result.measured).toBeGreaterThan(200);
  expect(result.failures).toEqual([]);
});

test('current belt cell is a 48 px button around a 24 px square', async ({ page }) => {
  await openGallery(page);
  const hit = page.locator('#belt .belt__hit').first();
  const hitBox = await hit.boundingBox();
  const squareBox = await hit.locator('.belt__square').boundingBox();
  expect(hitBox?.width).toBeGreaterThanOrEqual(48);
  expect(hitBox?.height).toBeGreaterThanOrEqual(48);
  expect(squareBox?.width).toBe(24);
  expect(squareBox?.height).toBe(24);
});

test('patient rows are 88 px collapsed', async ({ page }) => {
  await openGallery(page);
  const rows = page.locator('#rows .row');
  await expect(rows).toHaveCount(6);
  for (const box of await rows.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  )) {
    expect(box).toBe(88);
  }
});

test('timer chips keep the space between code and countdown', async ({ page }) => {
  await openGallery(page);
  await expect(page.locator('#rows .chip--danger').first()).toHaveText(/C1 overdue 05:00/);
  await expect(page.locator('#rows .chip--warning').first()).toHaveText(/BA in 25:00/);
  const rendered = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('#rows .chip--danger, #rows .chip--warning'),
    ).map((el) => el.innerText),
  );
  expect(rendered).toHaveLength(2);
  expect(rendered[0]).toContain('C1 overdue 05:00');
  expect(rendered[1]).toContain('BA in 25:00');
});

test('header chips stay inside the 48 px header and clear of the belt', async ({ page }) => {
  await openGallery(page);
  const rows = page.locator('#rows .row');
  await expect(rows).toHaveCount(6);
  const geometry = await rows.evaluateAll((els) =>
    els.map((row) => {
      const header = row.querySelector('.row__header')?.getBoundingClientRect();
      const belt = row.querySelector('.row__belt')?.getBoundingClientRect();
      const square = row.querySelector('.belt__square')?.getBoundingClientRect();
      const chips = Array.from(row.querySelectorAll('.row__side .chip')).map((c) =>
        c.getBoundingClientRect(),
      );
      return {
        chips: chips.length,
        headerHeight: header?.height,
        chipsInside:
          header !== undefined &&
          chips.every((c) => c.top >= header.top && c.bottom <= header.bottom),
        beltBelowHeader:
          header !== undefined &&
          belt !== undefined &&
          square !== undefined &&
          belt.top >= header.bottom &&
          square.top >= header.bottom,
      };
    }),
  );
  expect(geometry.filter((g) => g.chips === 2)).not.toHaveLength(0);
  for (const g of geometry) {
    expect(g.headerHeight).toBe(48);
    expect(g.chipsInside).toBe(true);
    expect(g.beltBelowHeader).toBe(true);
  }
});

test('patient sheet shows owner phone, task note and discharged states', async ({ page }) => {
  await openGallery(page);
  const tel = page.locator('#sheet a[href^="tel:"]');
  await expect(tel).toHaveCount(1);
  await expect(tel).toHaveAttribute('href', 'tel:+440000000000');
  const box = await tel.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeGreaterThanOrEqual(48);
  await expect(page.locator('#sheet .task__note')).toHaveText('Left fore, check for slippage');
  const discharged = page.locator('#sheet button', { hasText: /^Discharged \d\d:\d\d$/ });
  await expect(discharged).toHaveCount(1);
  await expect(discharged).toBeDisabled();
});

test('reduced motion zeroes animation and transition durations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGallery(page);
  const durations = await page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel);
      if (el === null) {
        return null;
      }
      const cs = getComputedStyle(el);
      return { animation: cs.animationDuration, transition: cs.transitionDuration };
    };
    return {
      done: read('.belt__square--done'),
      overdue: read('.belt__square--overdue'),
      progress: read('.row__progress-fill'),
    };
  });
  expect(durations.done).toEqual({ animation: '0s', transition: '0s' });
  expect(durations.overdue).toEqual({ animation: '0s', transition: '0s' });
  expect(durations.progress).toEqual({ animation: '0s', transition: '0s' });
});

test('animations run under 400 ms of motion when motion is allowed', async ({ page }) => {
  await openGallery(page);
  const durations = await page.evaluate(() => {
    const ms = (sel: string) => {
      const el = document.querySelector(sel);
      return el === null ? null : parseFloat(getComputedStyle(el).animationDuration) * 1000;
    };
    return { done: ms('.belt__square--done'), sweep: ms('.row__progress-fill--complete') };
  });
  expect(durations.done).toBe(120);
  expect(durations.sweep).toBe(400);
});

test('page never scrolls horizontally', async ({ page }) => {
  await openGallery(page);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});
