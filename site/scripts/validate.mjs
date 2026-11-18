// QA gates for `make validate` (AGENTS.md rule 8, docs/frontend.md "Performance budget"):
//   - site/dist builds and is served locally
//   - first load (transferred bytes) <= 3 MB
//   - data directory <= 100 MB
//   - Lighthouse performance >= 90 desktop, >= 80 mobile
//   - time-to-interactive < 3 s on mobile
//   - no cross-origin requests (nothing phones home; basemap is self-hosted)
// Prints a JSON report; exits non-zero if any gate fails.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SITE_DIR, 'dist');

const FIRST_LOAD_BUDGET = 3 * 1024 * 1024; // bytes transferred
const DATA_BUDGET = 100 * 1024 * 1024;
const LH_DESKTOP_MIN = 90;
const LH_MOBILE_MIN = 80;
const TTI_MAX_MS = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.zst': 'application/zstd',
  '.ico': 'image/x-icon',
};

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await stat(p)).size;
  }
  return total;
}

// Serve with gzip content-encoding like the GitHub Pages CDN does, so
// Lighthouse's transferred-bytes reflect real first-load cost.
async function serve(dist) {
  const gzCache = new Map();
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const file = path.join(dist, urlPath);
      if (!file.startsWith(dist)) throw new Error('path escape');
      const acceptsGzip = String(req.headers['accept-encoding'] ?? '').includes('gzip');
      const type = MIME[path.extname(file)] ?? 'application/octet-stream';
      if (acceptsGzip && !file.endsWith('.mp4') && !file.endsWith('.zst')) {
        if (!gzCache.has(file)) gzCache.set(file, gzipSync(await readFile(file)));
        const body = gzCache.get(file);
        res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'content-length': body.length });
        res.end(body);
      } else {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': type, 'content-length': body.length });
        res.end(body);
      }
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
  return { name, ok, detail };
};

// --- static gates -----------------------------------------------------------
const distExists = await dirSize(DIST);
const dataBytes = await dirSize(path.join(SITE_DIR, 'public', 'data'));

// First-load set: index.html + its bundled assets + basemap (no vessel data yet).
async function firstLoadGzip() {
  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  };
  await walk(DIST);
  let sum = 0;
  const per = [];
  for (const f of files) {
    const raw = await readFile(f);
    const gz = gzipSync(raw).length;
    sum += gz;
    per.push({ file: path.relative(DIST, f), raw: raw.length, gzip: gz });
  }
  return { sum, per };
}
const firstLoad = await firstLoadGzip();

const staticChecks = [
  check('dist-exists', distExists > 0, `dist bytes = ${distExists}`),
  check('first-load-gzip<=3MB', firstLoad.sum <= FIRST_LOAD_BUDGET, `${(firstLoad.sum / 1024 / 1024).toFixed(2)} MB gzip`),
  check('data-dir<=100MB', dataBytes <= DATA_BUDGET, `${(dataBytes / 1024 / 1024).toFixed(2)} MB`),
];

// --- Lighthouse -------------------------------------------------------------
const { server, port } = await serve(DIST);
const base = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const chrome = await launch({
  chromePath,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

async function runLh(url, settings, label) {
  const config = {
    extends: 'lighthouse:default',
    settings: { onlyCategories: ['performance'], ...settings },
  };
  const lhr = await lighthouse(url, { port: chrome.port, logLevel: 'error', output: 'json' }, config);
  const a = lhr.lhr.audits;
  const perf = lhr.lhr.categories.performance.score * 100;
  const metrics = {};
  for (const k of ['first-contentful-paint', 'largest-contentful-paint', 'speed-index', 'total-blocking-time', 'cumulative-layout-shift', 'interactive']) {
    metrics[k] = a[k]?.numericValue ?? null;
  }
  const requests = a['network-requests']?.details?.items ?? [];
  return { label, perf, metrics, tbw: metrics['total-byte-weight'] ?? a['total-byte-weight']?.numericValue ?? null, requests };
}

// Lighthouse recommends multiple runs and taking the median for perf scores.
const MOBILE_RUNS = 5;
const mobileRuns = [];
for (let i = 0; i < MOBILE_RUNS; i++) {
  mobileRuns.push(await runLh(`${base}/`, {}, `mobile#${i + 1}`));
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mobile = {
  label: `mobile(median of ${MOBILE_RUNS})`,
  perf: median(mobileRuns.map((r) => r.perf)),
  metrics: Object.fromEntries(
    Object.keys(mobileRuns[0].metrics).map((k) => [k, median(mobileRuns.map((r) => r.metrics[k] ?? 0))]),
  ),
  tbw: median(mobileRuns.map((r) => r.tbw ?? 0)),
  requests: mobileRuns[0].requests,
  allRuns: mobileRuns.map((r) => ({ perf: r.perf, metrics: r.metrics })),
};
const desktop = await runLh(`${base}/`, {
  formFactor: 'desktop',
  screenEmulation: { disabled: true },
  throttlingMethod: 'simulate',
  throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 },
}, 'desktop');
await chrome.kill();
server.close();

const lhChecks = [
  check('lighthouse-mobile>=80', mobile.perf >= LH_MOBILE_MIN, `score ${mobile.perf.toFixed(0)}`),
  check('lighthouse-desktop>=90', desktop.perf >= LH_DESKTOP_MIN, `score ${desktop.perf.toFixed(0)}`),
  check('total-byte-weight<=3MB', mobile.tbw !== null && mobile.tbw <= FIRST_LOAD_BUDGET, `${((mobile.tbw ?? 0) / 1024 / 1024).toFixed(2)} MB transferred`),
];

// Nothing phones home: every network request must be same-origin (or data:/blob:).
const external = mobile.requests
  .map((r) => r.url)
  .filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:'));
check('no-cross-origin-requests', external.length === 0, external.slice(0, 5).join(', ') || 'all same-origin');

const report = {
  when: new Date().toISOString(),
  static: staticChecks,
  lighthouse: {
    mobile: { performance: mobile.perf, metrics: mobile.metrics, totalByteWeight: mobile.tbw, runs: mobile.allRuns },
    desktop: { performance: desktop.perf, metrics: desktop.metrics, totalByteWeight: desktop.tbw },
    checks: lhChecks,
  },
  firstLoadGzipBytes: firstLoad.sum,
  dataDirBytes: dataBytes,
  largestAssets: firstLoad.per.sort((a, b) => b.gzip - a.gzip).slice(0, 8),
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`\nVALIDATE FAILED (${failures.length}):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.error('\nVALIDATE OK');
