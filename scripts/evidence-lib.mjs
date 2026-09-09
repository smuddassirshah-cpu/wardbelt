// Decision notes: shared helpers for the stage 7 evidence scripts (bundle size, hardening
// checks, Lighthouse). Output goes through process.stdout so the scripts pass the repo's
// no-console lint rule; every summary written to docs/evidence carries the date and commit so
// the numbers in docs/TESTING.md are traceable to a run. Summaries are formatted through the
// repo's own Prettier (a dev dependency already) so `prettier --check .` accepts them.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DIST = resolve(ROOT, 'dist');
export const EVIDENCE_DIR = resolve(ROOT, 'docs', 'evidence');

export function out(...lines) {
  process.stdout.write(`${lines.length === 0 ? '' : lines.join('\n')}\n`);
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

export function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/** Runs `npm run build` unless `--no-build` was given; fails loudly if dist is then missing. */
export function ensureBuild() {
  if (!hasFlag('--no-build')) {
    out('> npm run build');
    const result = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`npm run build exited with ${String(result.status)}`);
    }
  }
  if (!existsSync(resolve(DIST, 'index.html'))) {
    throw new Error('dist/index.html is missing: run npm run build first or drop --no-build');
  }
}

/** Formats JSON the way `prettier --check .` expects, so evidence files pass the lint gate. */
export async function prettyJson(path, value) {
  const config = (await resolveConfig(path)) ?? {};
  return format(JSON.stringify(value, null, 2), { ...config, parser: 'json' });
}

/** Writes a small JSON summary under docs/evidence when `--write` was given. */
export async function writeEvidence(name, data) {
  if (!hasFlag('--write')) {
    return;
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = resolve(EVIDENCE_DIR, name);
  const stamped = { generatedAt: new Date().toISOString(), commit: gitSha(), ...data };
  writeFileSync(path, await prettyJson(path, stamped));
  out(`wrote ${path}`);
}

export function kb(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}

/** Fixed-width text table: rows are arrays of strings, first row is the header. */
export function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(rows[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.slice(1).map(line)];
}

export function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}
