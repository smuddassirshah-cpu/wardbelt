import { expect, test } from '@playwright/test';

test('page opens and shows the app name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wardbelt' })).toBeVisible();
});

test('manifest and service worker are served', async ({ page, request }) => {
  await page.goto('/');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as { name?: string; icons?: unknown[] };
  expect(body.name).toBe('Wardbelt');
  expect(Array.isArray(body.icons)).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
});
