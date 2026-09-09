// Decision notes: the stage 8 install check (PLAN.md section 11): the served manifest is
// installable on Android Chrome and the service worker takes control of the page. The app base
// is read from the page's own manifest link rather than hard-coded, so the same assertions hold
// on the GitHub Pages sub-path (`/wardbelt/`) as on the local preview (`/`). Every icon the
// manifest names is fetched and checked for a PNG signature, not just a 200, because a missing
// or mislabelled icon is the most common reason an install prompt never appears.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  scope: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function manifestUrl(page: Page): Promise<URL> {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).not.toBeNull();
  return new URL(href ?? '', page.url());
}

async function expectPng(request: APIRequestContext, url: URL): Promise<void> {
  const response = await request.get(url.href);
  expect(response.status(), url.href).toBe(200);
  expect(response.headers()['content-type'], url.href).toMatch(/^image\/png/);
  const body = await response.body();
  expect(body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), url.href).toBe(true);
}

test('manifest is installable and its icons exist', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wardbelt' })).toBeVisible();

  const url = await manifestUrl(page);
  const base = url.pathname.replace(/manifest\.webmanifest$/, '');
  expect(base.endsWith('/')).toBe(true);

  const response = await request.get(url.href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
  const manifest = (await response.json()) as Manifest;

  expect(manifest.name).toBe('Wardbelt');
  expect(manifest.short_name).toBe('Wardbelt');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe(base);
  expect(manifest.scope).toBe(base);
  expect(manifest.theme_color).toBe('#0F6E56');
  expect(manifest.background_color).toBe('#FAFAF9');

  const lightThemeColour = page.locator('meta[name="theme-color"]').first();
  await expect(lightThemeColour).toHaveAttribute('content', manifest.theme_color);

  const byPurpose = (sizes: string, maskable: boolean): ManifestIcon | undefined =>
    manifest.icons.find((i) => i.sizes === sizes && (i.purpose === 'maskable') === maskable);
  const required = [
    byPurpose('192x192', false),
    byPurpose('512x512', false),
    byPurpose('512x512', true),
  ];
  for (const icon of required) {
    expect(icon).toBeDefined();
    expect(icon?.type).toBe('image/png');
  }
  for (const icon of manifest.icons) {
    await expectPng(request, new URL(icon.src, url));
  }
});

test('page links the manifest and an apple-touch-icon that exists', async ({ page, request }) => {
  await page.goto('/');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  const touch = page.locator('link[rel="apple-touch-icon"]');
  await expect(touch).toHaveCount(1);
  const href = await touch.getAttribute('href');
  expect(href).not.toBeNull();
  await expectPng(request, new URL(href ?? '', page.url()));
});

test('service worker becomes ready and controls the page after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wardbelt' })).toBeVisible();

  const ready = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      active: registration.active?.state ?? null,
    };
  });
  const base = (await manifestUrl(page)).pathname.replace(/manifest\.webmanifest$/, '');
  expect(new URL(ready.scope).pathname).toBe(base);
  expect(['activating', 'activated']).toContain(ready.active);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Wardbelt' })).toBeVisible();
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller?.scriptURL ?? null;
  });
  expect(controlled).not.toBeNull();
  expect(new URL(controlled ?? '').pathname).toBe(`${base}sw.js`);
});
