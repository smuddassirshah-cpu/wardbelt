// Decision notes: stage 7 axe pass over the real board with data rather than the dev gallery:
// two patients (one fresh with an intake chip, one back from theatre with an overdue check
// under the fake clock so the danger chip and the pulsing cell are on screen), then the open
// patient sheet with due times, a note and an enabled Undo. Both themes are audited: light,
// and dark through prefers-color-scheme, with the body background asserted so the palette
// under test is the one claimed. The per-scene axe counts (rules that passed, failed, were
// incomplete or did not apply) are attached to the test and, when WARDBELT_EVIDENCE is set,
// merged into docs/evidence/axe.json so docs/TESTING.md quotes a run, not a guess.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  addPatient,
  completeThroughTheatre,
  openSheet,
  ready,
  row,
  smallTargets,
  taskItem,
} from './helpers';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];
const LIGHT_BG = 'rgb(250, 250, 249)';
const DARK_BG = 'rgb(18, 18, 18)';
const EVIDENCE = resolve('docs', 'evidence', 'axe.json');

interface AxeScene {
  scene: string;
  violations: number;
  violationIds: string[];
  passes: number;
  incomplete: number;
  incompleteIds: string[];
  inapplicable: number;
  rulesRun: number;
}

interface AxeEvidence {
  generatedAt: string;
  axeVersion: string;
  tags: string[];
  themes: Record<string, AxeScene[]>;
}

async function audit(page: Page, scene: string): Promise<{ result: AxeScene; version: string }> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const rulesRun =
    results.passes.length +
    results.violations.length +
    results.incomplete.length +
    results.inapplicable.length;
  return {
    version: results.testEngine.version,
    result: {
      scene,
      violations: results.violations.length,
      violationIds: results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      incompleteIds: results.incomplete.map((r) => {
        const reasons = new Set(
          r.nodes.flatMap((n) => [...n.any, ...n.all, ...n.none].map((c) => c.message)),
        );
        return `${r.id} (${String(r.nodes.length)} nodes needing manual review: ${[...reasons].join('; ')})`;
      }),
      inapplicable: results.inapplicable.length,
      rulesRun,
    },
  };
}

async function recordEvidence(theme: string, version: string, scenes: AxeScene[]): Promise<void> {
  if (process.env.WARDBELT_EVIDENCE === undefined) {
    return;
  }
  const existing: AxeEvidence | undefined = existsSync(EVIDENCE)
    ? (JSON.parse(readFileSync(EVIDENCE, 'utf8')) as AxeEvidence)
    : undefined;
  const merged: AxeEvidence = {
    generatedAt: new Date().toISOString(),
    axeVersion: version,
    tags: AXE_TAGS,
    themes: { ...existing?.themes, [theme]: scenes },
  };
  mkdirSync(resolve('docs', 'evidence'), { recursive: true });
  const config = (await resolveConfig(EVIDENCE)) ?? {};
  writeFileSync(
    EVIDENCE,
    await format(JSON.stringify(merged, null, 2), { ...config, parser: 'json' }),
  );
}

/** Board with a fresh patient and an overdue post-op check, then the recovering patient's sheet. */
async function boardWithData(page: Page, theme: string, info: TestInfo): Promise<void> {
  await page.clock.install({ time: new Date(2026, 2, 10, 10, 0, 0) });
  await page.goto('/');
  await ready(page);
  await addPatient(page, 'Fixture Nu', 'Dental', { species: 'Cat', intake: '10:00' });
  await addPatient(page, 'Fixture Xi', 'Spay');
  await completeThroughTheatre(page, 'Fixture Xi');
  await page.clock.fastForward(16 * 60_000);
  const late = row(page, 'Fixture Xi');
  await expect(late.locator('.chip--danger')).toHaveText(/C1 overdue/);
  await expect(late.locator('.belt__square--overdue')).toHaveCount(1);
  await expect(row(page, 'Fixture Nu').getByText('10:00')).toBeVisible();

  const board = await audit(page, 'board with an intake chip and an overdue check');
  expect(board.result.violationIds).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);

  const sheet = await openSheet(page, 'Fixture Xi');
  await expect(taskItem(sheet, 'Post-op check 1').locator('.task__meta')).toContainText('Due');
  const noteToggle = taskItem(sheet, 'Post-op check 2').getByRole('button', {
    name: 'Edit note for Post-op check 2',
  });
  await noteToggle.click();
  const note = sheet.getByLabel('Note for Post-op check 2', { exact: true });
  await note.fill('Fixture note');
  await note.blur();
  await noteToggle.click();
  await expect(taskItem(sheet, 'Post-op check 2').locator('.task__note')).toHaveText(
    'Fixture note',
  );
  await expect(sheet.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await sheet.locator('.sheet__body').evaluate((el) => {
    el.scrollTo(0, 0);
  });
  const open = await audit(page, 'patient sheet with due times, a note and undo');
  expect(open.result.violationIds).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);

  const scenes = [board.result, open.result];
  for (const scene of scenes) {
    expect(scene.violations).toBe(0);
    expect(scene.rulesRun).toBeGreaterThan(50);
  }
  await info.attach(`axe-${theme}`, {
    body: JSON.stringify({ axeVersion: open.version, scenes }, null, 2),
    contentType: 'application/json',
  });
  await recordEvidence(theme, open.version, scenes);
}

test('light theme: board with data and open sheet are axe clean', async ({ page }, info) => {
  await boardWithData(page, 'light', info);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG);
});

test('dark theme: board with data and open sheet are axe clean', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await boardWithData(page, 'dark', info);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(DARK_BG);
});
