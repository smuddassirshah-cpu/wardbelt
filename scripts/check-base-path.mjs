// Decision notes: GitHub Pages serves the app under /<repository>/, so pages.yml builds with
// VITE_BASE_PATH=/wardbelt/. This script proves that build is right before anything is pushed:
// it runs `vite build` with that base into a temporary directory (the default `dist/` is left
// untouched, so nothing has to be restored afterwards) and asserts that the manifest's
// start_url and scope are the sub-path, that index.html loads its assets and manifest from it,
// and that the service worker is registered from it. Each check prints PASS or FAIL; any FAIL
// exits 1. Usage: node scripts/check-base-path.mjs [--base /wardbelt/] [--keep]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fail, hasFlag, out, ROOT } from './evidence-lib.mjs';

const baseIndex = process.argv.indexOf('--base');
export const BASE = baseIndex >= 0 ? (process.argv[baseIndex + 1] ?? '/wardbelt/') : '/wardbelt/';
if (!BASE.startsWith('/') || !BASE.endsWith('/')) {
  throw new Error(`--base must start and end with a slash, got ${BASE}`);
}

const outDir = mkdtempSync(join(tmpdir(), 'wardbelt-base-path-'));
out(`> VITE_BASE_PATH=${BASE} vite build --outDir ${outDir}`);
const build = spawnSync(
  process.execPath,
  [
    resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--outDir',
    outDir,
    '--emptyOutDir',
  ],
  {
    cwd: ROOT,
    env: { ...process.env, VITE_BASE_PATH: BASE },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
if (build.status !== 0) {
  throw new Error(`vite build exited with ${String(build.status)}`);
}

let failures = 0;
function check(name, ok, detail) {
  out(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) {
    failures += 1;
    fail(name);
  }
}

try {
  const manifest = JSON.parse(readFileSync(resolve(outDir, 'manifest.webmanifest'), 'utf8'));
  check('manifest start_url is the base', manifest.start_url === BASE, String(manifest.start_url));
  check('manifest scope is the base', manifest.scope === BASE, String(manifest.scope));

  const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
  const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const assets = assetRefs.filter((u) => u.includes('/assets/'));
  const underBase = assets.filter((u) => u.startsWith(`${BASE}assets/`));
  check(
    'index.html loads every asset from the base',
    assets.length > 0 && underBase.length === assets.length,
    `${String(underBase.length)} of ${String(assets.length)} asset references start with ${BASE}assets/`,
  );
  check(
    'index.html links the manifest under the base',
    html.includes(`href="${BASE}manifest.webmanifest"`),
    assetRefs.find((u) => u.endsWith('manifest.webmanifest')) ?? 'no manifest link',
  );
  const absoluteOutsideBase = assetRefs.filter((u) => u.startsWith('/') && !u.startsWith(BASE));
  check(
    'index.html has no absolute reference outside the base',
    absoluteOutsideBase.length === 0,
    absoluteOutsideBase.join(', ') || 'none',
  );

  const jsFiles = readdirSync(resolve(outDir, 'assets')).filter((f) => f.endsWith('.js'));
  const registersSw = jsFiles.some((f) =>
    readFileSync(resolve(outDir, 'assets', f), 'utf8').includes(`${BASE}sw.js`),
  );
  check('service worker is registered from the base', registersSw, `${BASE}sw.js referenced`);
  check('sw.js is emitted', existsSync(resolve(outDir, 'sw.js')), resolve(outDir, 'sw.js'));

  out(
    failures === 0 ? `all checks passed for base ${BASE}` : `${String(failures)} check(s) failed`,
  );
} finally {
  if (hasFlag('--keep')) {
    out(`kept ${outDir}`);
  } else {
    rmSync(outDir, { recursive: true, force: true });
  }
}
