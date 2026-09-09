// Decision notes: PLAN.md section 11 stage 7 caps the shell's JS and CSS at 60 kB gzipped.
// Counted: every dist/assets/*.js and *.css (lazy chunks included, so the figure is the
// worst case); not counted: sw.js (a worker, not shell code) and index.html. Sizes come from
// node:zlib gzipSync at the default level, which is what a static host serves. Kilobytes are
// decimal (1 kB = 1000 bytes) to match Vite's own build output. Exits 1 over the limit.
// Usage: node scripts/bundle-size.mjs [--no-build] [--write]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIST, ensureBuild, fail, kb, out, table, writeEvidence } from './evidence-lib.mjs';

export const LIMIT_BYTES = 60_000;

ensureBuild();

const assets = resolve(DIST, 'assets');
const files = readdirSync(assets)
  .filter((name) => /\.(js|css)$/.test(name))
  .sort()
  .map((name) => {
    const raw = readFileSync(resolve(assets, name));
    return { name: `assets/${name}`, raw: raw.length, gzip: gzipSync(raw).length };
  });

const total = files.reduce((sum, f) => sum + f.gzip, 0);
const sw = statSync(resolve(DIST, 'sw.js')).size;
const swGzip = gzipSync(readFileSync(resolve(DIST, 'sw.js'))).length;

out(
  ...table([
    ['file', 'raw', 'gzip'],
    ...files.map((f) => [f.name, kb(f.raw), kb(f.gzip)]),
    ['total (limit 60.00 kB)', kb(files.reduce((s, f) => s + f.raw, 0)), kb(total)],
  ]),
);
out(`sw.js (not counted): ${kb(sw)} raw, ${kb(swGzip)} gzip`);

if (total > LIMIT_BYTES) {
  fail(`shell JS and CSS gzip total ${kb(total)} exceeds the ${kb(LIMIT_BYTES)} limit`);
} else {
  out(`OK: ${kb(total)} gzipped, ${kb(LIMIT_BYTES - total)} under the limit`);
}

await writeEvidence('bundle-size.json', {
  limitBytes: LIMIT_BYTES,
  totalGzipBytes: total,
  files,
  serviceWorker: { name: 'sw.js', raw: sw, gzip: swGzip },
});
