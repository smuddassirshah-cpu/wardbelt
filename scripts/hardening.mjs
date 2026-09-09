// Decision notes: static checks over the production build for the stage 7 hardening
// checklist (PLAN.md sections 7 and 8): the CSP meta is present verbatim, nothing in
// dist/index.html runs inline, the app's own JS never calls console, the service worker
// precaches index.html, the manifest and every asset, and every precache entry carries a
// revision key so Workbox's one library-level console.warn (fired only for entries without
// one) is dead code. The manifest is checked for the installability fields. Each check prints
// PASS or FAIL with what was seen; any FAIL exits 1. Usage: node scripts/hardening.mjs
// [--no-build] [--write]
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIST, ensureBuild, fail, out, writeEvidence } from './evidence-lib.mjs';

export const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'";

ensureBuild();

const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
const sw = readFileSync(resolve(DIST, 'sw.js'), 'utf8');
const assetNames = readdirSync(resolve(DIST, 'assets')).sort();
const assets = assetNames.map((name) => ({
  name: `assets/${name}`,
  text: readFileSync(resolve(DIST, 'assets', name), 'utf8'),
}));
const manifest = JSON.parse(readFileSync(resolve(DIST, 'manifest.webmanifest'), 'utf8'));

/** Precache manifest: the first JSON array of {revision, url} objects in sw.js. */
function precacheEntries(source) {
  const start = source.indexOf('[{"revision"');
  if (start < 0) {
    return [];
  }
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, i + 1));
      }
    }
  }
  return [];
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  out(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) {
    fail(name);
  }
}

const cspMatch = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
check('CSP meta present in dist/index.html', cspMatch?.[1] === CSP, cspMatch?.[1] ?? 'absent');

const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)].length;
const handlers = [...html.matchAll(/\son[a-z]+\s*=/gi)].length;
const jsUrls = [...html.matchAll(/javascript:/gi)].length;
check(
  'no inline script, handler attribute or javascript: URL in dist/index.html',
  inlineScripts + handlers + jsUrls === 0,
  `${String(inlineScripts)} inline scripts, ${String(handlers)} handlers, ${String(jsUrls)} javascript: URLs`,
);

const consoleInAssets = assets
  .map((a) => ({ name: a.name, count: (a.text.match(/console\./g) ?? []).length }))
  .filter((a) => a.count > 0);
check(
  'no console call in dist/assets/*.js',
  consoleInAssets.length === 0,
  consoleInAssets.length === 0
    ? `0 matches across ${String(assetNames.length)} files`
    : consoleInAssets.map((a) => `${a.name}: ${String(a.count)}`).join(', '),
);

const swConsole = sw.match(/console\.\w+/g) ?? [];
const workboxGuard = sw.includes('Workbox is precaching URLs without revision info');
check(
  'sw.js console use limited to the Workbox no-revision guard',
  swConsole.length === 1 && swConsole[0] === 'console.warn' && workboxGuard,
  `${String(swConsole.length)} match(es): ${swConsole.join(', ') || 'none'}; guard text ${workboxGuard ? 'present' : 'absent'}`,
);

const entries = precacheEntries(sw);
const urls = new Set(entries.map((e) => e.url));
const required = ['index.html', 'manifest.webmanifest', ...assets.map((a) => a.name)];
const missing = required.filter((u) => !urls.has(u));
check(
  'sw.js precaches index.html, the manifest and every asset',
  entries.length > 0 && missing.length === 0,
  `${String(entries.length)} entries (${String(urls.size)} unique), missing: ${missing.join(', ') || 'none'}`,
);

const withoutRevision = entries.filter((e) => !('revision' in e)).map((e) => e.url);
check(
  'every precache entry has a revision key (Workbox guard cannot fire)',
  entries.length > 0 && withoutRevision.length === 0,
  withoutRevision.length === 0 ? 'all entries carry revision' : withoutRevision.join(', '),
);

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
const sizes = new Set(icons.map((i) => i.sizes));
const maskable = icons.some((i) => i.purpose === 'maskable');
check(
  'manifest is installable',
  manifest.display === 'standalone' &&
    typeof manifest.name === 'string' &&
    typeof manifest.start_url === 'string' &&
    sizes.has('192x192') &&
    sizes.has('512x512') &&
    maskable,
  `display ${String(manifest.display)}, icons ${[...sizes].join('/')}, maskable ${String(maskable)}`,
);

const evalUse = assets
  .map((a) => ({ name: a.name, count: (a.text.match(/\beval\(|new Function\(/g) ?? []).length }))
  .filter((a) => a.count > 0);
check(
  'no eval or Function constructor in dist JS',
  evalUse.length === 0,
  evalUse.length === 0
    ? '0 matches'
    : evalUse.map((a) => `${a.name}: ${String(a.count)}`).join(', '),
);

out(
  process.exitCode === 1
    ? `${String(results.filter((r) => !r.ok).length)} check(s) failed`
    : `all ${String(results.length)} checks passed`,
);

await writeEvidence('hardening.json', {
  csp: CSP,
  precacheEntries: entries.length,
  precacheUrls: [...urls],
  checks: results,
});
