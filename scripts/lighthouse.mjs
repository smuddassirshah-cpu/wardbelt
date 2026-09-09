// Decision notes: reproducible Lighthouse run for PLAN.md section 11 stage 7 (PWA,
// performance, accessibility >= 95 on the mobile profile). Lighthouse is invoked through
// `npx --yes lighthouse@<pinned>` as a tool, not a dependency (package.json is frozen and
// section 10 lists no audit tool). Lighthouse 12 removed the PWA category, so the current
// release audits performance, accessibility and best practices and 11.7.1 (the last with the
// category) audits PWA. The production build is served by `vite preview` on 4173; an already
// running preview is reused, otherwise one is started and stopped here. Chrome comes from
// CHROME_PATH, else Google Chrome, else Playwright's Chromium, else chrome-launcher's own
// search. Full reports land in a temp directory; only trimmed summaries (scores, metrics,
// failing audit ids) go to docs/evidence so nothing large is committed.
// Usage: node scripts/lighthouse.mjs [--no-build] [--write]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ensureBuild,
  fail,
  hasFlag,
  kb,
  out,
  ROOT,
  table,
  writeEvidence,
} from './evidence-lib.mjs';

export const LIGHTHOUSE_CURRENT = '13.4.1';
export const LIGHTHOUSE_PWA = '11.7.1';
export const URL_UNDER_TEST = 'http://localhost:4173/';
export const TARGET = 0.95;
const CHROME_FLAGS = '--headless=new';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function findChrome() {
  if (process.env.CHROME_PATH !== undefined) {
    return process.env.CHROME_PATH;
  }
  if (existsSync(MAC_CHROME)) {
    return MAC_CHROME;
  }
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()) {
      for (const arch of ['chrome-mac-arm64', 'chrome-mac']) {
        const candidate = join(
          cache,
          dir,
          arch,
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        );
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

async function isUp(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isUp(url)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

function runLighthouse(version, categories, reportPath, chrome) {
  const args = [
    '--yes',
    `lighthouse@${version}`,
    URL_UNDER_TEST,
    `--only-categories=${categories.join(',')}`,
    `--chrome-flags=${CHROME_FLAGS}`,
    '--output=json',
    `--output-path=${reportPath}`,
    '--quiet',
  ];
  const env = chrome === undefined ? process.env : { ...process.env, CHROME_PATH: chrome };
  out(`> npx ${args.join(' ')}`);
  const result = spawnSync('npx', args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`lighthouse@${version} exited with ${String(result.status)}`);
  }
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

function summarise(report) {
  const categories = {};
  const auditCounts = {};
  const failing = [];
  for (const [id, category] of Object.entries(report.categories)) {
    categories[id] = category.score;
    const counts = { total: 0, passed: 0, notApplicable: 0, manual: 0, informative: 0 };
    for (const ref of category.auditRefs) {
      const audit = report.audits[ref.id];
      counts.total += 1;
      if (audit.scoreDisplayMode === 'notApplicable') {
        counts.notApplicable += 1;
      } else if (audit.scoreDisplayMode === 'manual') {
        counts.manual += 1;
      } else if (audit.scoreDisplayMode === 'informative') {
        counts.informative += 1;
      } else if (audit.score === 1) {
        counts.passed += 1;
      }
      if (audit.score !== null && audit.score < 1) {
        failing.push({
          category: id,
          id: ref.id,
          score: audit.score,
          displayValue: audit.displayValue ?? '',
        });
      }
    }
    auditCounts[id] = counts;
  }
  const metricIds = [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
    'speed-index',
  ];
  const metrics = {};
  for (const id of metricIds) {
    if (report.audits[id] !== undefined) {
      metrics[id] = report.audits[id].displayValue;
    }
  }
  return {
    lighthouseVersion: report.lighthouseVersion,
    userAgent: report.environment.hostUserAgent,
    formFactor: report.configSettings.formFactor,
    throttlingMethod: report.configSettings.throttlingMethod,
    url: report.finalDisplayedUrl ?? report.requestedUrl,
    categories,
    auditCounts,
    metrics,
    failingAudits: failing,
  };
}

ensureBuild();
const chrome = findChrome();
out(`chrome: ${chrome ?? 'left to chrome-launcher'}`);

const reuse = await isUp(URL_UNDER_TEST);
const preview = reuse
  ? undefined
  : spawn(
      process.execPath,
      [
        resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
        'preview',
        '--port',
        '4173',
        '--strictPort',
      ],
      { cwd: ROOT, stdio: 'ignore' },
    );
out(
  reuse ? `reusing the server on ${URL_UNDER_TEST}` : `started vite preview on ${URL_UNDER_TEST}`,
);

try {
  await waitFor(URL_UNDER_TEST);
  const dir = mkdtempSync(join(tmpdir(), 'wardbelt-lighthouse-'));
  const current = summarise(
    runLighthouse(
      LIGHTHOUSE_CURRENT,
      ['performance', 'accessibility', 'best-practices'],
      resolve(dir, 'current.json'),
      chrome,
    ),
  );
  const pwa = summarise(runLighthouse(LIGHTHOUSE_PWA, ['pwa'], resolve(dir, 'pwa.json'), chrome));

  const scores = { ...current.categories, ...pwa.categories };
  const rows = Object.entries(scores).map(([id, score]) => [
    id,
    String(Math.round(score * 100)),
    id === 'best-practices' ? 'reported' : score >= TARGET ? 'PASS' : 'FAIL',
  ]);
  out('', ...table([['category', 'score', `target ${String(TARGET * 100)}`], ...rows]));
  out(
    '',
    ...Object.entries(current.metrics).map(([id, value]) => `${id}: ${value}`),
    `full reports: ${dir} (${kb(Buffer.byteLength(JSON.stringify(current)))} summarised)`,
  );
  for (const [id, score] of Object.entries(scores)) {
    if (id !== 'best-practices' && score < TARGET) {
      fail(`${id} scored ${String(Math.round(score * 100))}, below ${String(TARGET * 100)}`);
    }
  }
  for (const audit of [...current.failingAudits, ...pwa.failingAudits]) {
    out(
      `audit below 1: ${audit.category}/${audit.id} ${String(audit.score)} ${audit.displayValue}`,
    );
  }
  await writeEvidence('lighthouse.json', {
    command: `node scripts/lighthouse.mjs${hasFlag('--no-build') ? ' --no-build' : ''} --write`,
    chrome: chrome ?? 'chrome-launcher default',
    target: TARGET,
    current,
    pwa,
  });
} finally {
  if (preview !== undefined) {
    preview.kill();
  }
}
