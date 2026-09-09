// Decision notes: turns coverage/coverage-summary.json (written by `npm test`) into the table
// docs/TESTING.md quotes: every src/domain file (the 100% gate) plus per-directory totals for
// store, scheduler, ui and ui/app. Vitest's text reporter omits fully covered files, so the
// per-file domain rows are only visible this way. Reads the last run; never runs the tests.
// Usage: node scripts/coverage-table.mjs [--write]
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { out, ROOT, table, writeEvidence } from './evidence-lib.mjs';

const SUMMARY = resolve(ROOT, 'coverage', 'coverage-summary.json');
if (!existsSync(SUMMARY)) {
  throw new Error('coverage/coverage-summary.json is missing: run npm test first');
}
const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const METRICS = ['statements', 'branches', 'functions', 'lines'];
const DIRS = ['src/domain', 'src/store', 'src/scheduler', 'src/ui/app', 'src/ui'];

function dirOf(file) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  return rel.startsWith('src/ui/app/') ? 'src/ui/app' : rel.slice(0, rel.lastIndexOf('/'));
}

const totals = Object.fromEntries(
  DIRS.map((d) => [d, Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]))]),
);
const domainFiles = [];
for (const [file, cov] of Object.entries(summary)) {
  if (file === 'total') {
    continue;
  }
  const dir = dirOf(file);
  if (totals[dir] === undefined) {
    continue;
  }
  for (const m of METRICS) {
    totals[dir][m].covered += cov[m].covered;
    totals[dir][m].total += cov[m].total;
  }
  if (dir === 'src/domain') {
    domainFiles.push({ file: relative(ROOT, file), ...cov });
  }
}

const pct = (c) => (c.total === 0 ? '100' : ((100 * c.covered) / c.total).toFixed(2));
const cell = (c) => `${pct(c)}% (${String(c.covered)}/${String(c.total)})`;
const header = ['scope', 'statements', 'branches', 'functions', 'lines'];
const rows = [
  ...domainFiles
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((f) => [f.file, ...METRICS.map((m) => cell(f[m]))]),
  ...DIRS.map((d) => [`${d} (total)`, ...METRICS.map((m) => cell(totals[d][m]))]),
  ['all files', ...METRICS.map((m) => cell(summary.total[m]))],
];
out(...table([header, ...rows]));

await writeEvidence('coverage.json', {
  domainFiles: domainFiles.map((f) => ({
    file: f.file,
    ...Object.fromEntries(METRICS.map((m) => [m, f[m].pct])),
  })),
  totals: Object.fromEntries(
    DIRS.map((d) => [d, Object.fromEntries(METRICS.map((m) => [m, Number(pct(totals[d][m]))]))]),
  ),
  allFiles: Object.fromEntries(METRICS.map((m) => [m, summary.total[m].pct])),
});
