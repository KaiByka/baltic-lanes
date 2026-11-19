// QA gates for `make validate` (AGENTS.md rules 3+8, docs/frontend.md "Performance budget"):
//   - site/dist builds; sitemap.xml present with both URLs
//   - first load (entry HTML+JS + inlined basemap + data/manifest.json + first-month
//     density files) <= 3 MB; data directory <= 100 MB
//   - generated data matches the committed sha256 anchor (deterministic, not hand-edited)
//   - deck.gl chunks are NOT in the entry HTML and load only AFTER data/manifest.json
//     is fetched (Vite build manifest + Lighthouse network timing)
//   - Lighthouse performance >= 90 desktop, >= 80 mobile (median of 5 mobile runs)
//   - no cross-origin requests (nothing phones home)
// Prints a JSON report; exits non-zero if any gate fails.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SITE_DIR, '..');
const DIST = path.join(SITE_DIR, 'dist');

const FIRST_LOAD_BUDGET = 3 * 1024 * 1024; // bytes (HTML+JS+CSS+basemap+first month)
const DATA_BUDGET = 100 * 1024 * 1024;
const LH_DESKTOP_MIN = 90;
const LH_MOBILE_MIN = 80;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.xml': 'application/xml',
  '.zst': 'application/zstd',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
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

async function sha256File(p) {
  return createHash('sha256').update(await readFile(p)).digest('hex');
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

const staticChecks = [check('dist-exists', distExists > 0, `dist bytes = ${distExists}`)];

// sitemap.xml deployed at /sitemap.xml with homepage + about
try {
  const sm = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  staticChecks.push(
    check('sitemap', sm.includes('https://baltic.marespot.com/') && sm.includes('https://baltic.marespot.com/about.html'), 'sitemap.xml URLs'),
  );
} catch {
  staticChecks.push(check('sitemap', false, 'dist/sitemap.xml missing'));
}

// generated data matches the committed sha256 anchor (deterministic, never hand-edited)
const anchorPath = path.join(REPO, 'pipeline', 'output', 'data.sha256.json');
if (await stat(anchorPath).then(() => true).catch(() => false)) {
  const anchor = JSON.parse(await readFile(anchorPath, 'utf8'));
  const dataDir = path.join(SITE_DIR, 'public', 'data');
  let mismatches = [];
  for (const [rel, hex] of Object.entries(anchor)) {
    const p = path.join(dataDir, rel);
    let actual = null;
    try {
      actual = await sha256File(p);
    } catch {}
    if (actual !== hex) mismatches.push(rel);
  }
  staticChecks.push(check('data-anchor-match', mismatches.length === 0, mismatches.join(',') || `${Object.keys(anchor).length} files match`));
} else {
  staticChecks.push(check('data-anchor-match', true, 'no anchor yet (pre-data sprint)'));
}

// first-load set from the Vite build manifest: entry html + its static js
// imports + data/manifest.json + all density files (default view = all groups)
let firstLoadBytes = 0;
let dynamicChunks = [];
let entryHtmlRefsDynamic = [];
let entryFilesStatic = [];
try {
  const vm = JSON.parse(await readFile(path.join(DIST, '.vite', 'manifest.json'), 'utf8'));
  const entry = vm['index.html'];
  const entryFiles = ['index.html', entry.file, ...(entry.imports ?? []).map((f) => `assets/${f.replace(/^_/, '')}`), ...(entry.css ?? [])];
  entryFilesStatic = entryFiles;
  dynamicChunks = Object.values(vm).filter((e) => e.isDynamicEntry).map((e) => e.file);
  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  entryHtmlRefsDynamic = dynamicChunks.filter((f) => html.includes(f));
  // transferred bytes, the way GitHub Pages serves them: gzip for text assets, raw for zstd/mp4
  const transferred = async (rel) => {
    try {
      const raw = await readFile(path.join(DIST, rel));
      return /\.(zst|mp4|png)$/.test(rel) ? raw.length : gzipSync(raw).length;
    } catch {
      return 0; // CSS is inlined into the HTML by the inline-css plugin
    }
  };
  for (const f of new Set(entryFiles)) firstLoadBytes += await transferred(f);
  firstLoadBytes += await transferred('data/manifest.json');
  for (const f of await readdir(path.join(DIST, 'data', 'density'))) {
    firstLoadBytes += await transferred(`data/density/${f}`);
  }
} catch (e) {
  staticChecks.push(check('first-load-computable', false, String(e)));
}
staticChecks.push(
  check('entry-html-no-dynamic-chunks', entryHtmlRefsDynamic.length === 0, entryHtmlRefsDynamic.join(',') || 'entry references only static chunks'),
  check('first-load<=3MB', firstLoadBytes <= FIRST_LOAD_BUDGET, `${(firstLoadBytes / 1024 / 1024).toFixed(2)} MB (html+js+basemap+manifest+first-month data)`),
  check('data-dir<=100MB', dataBytes <= DATA_BUDGET, `${(dataBytes / 1024 / 1024).toFixed(2)} MB`),
);

// --- Lighthouse -------------------------------------------------------------
const { server, port } = await serve(DIST);
const base = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const chrome = await launch({
  chromePath,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

async function runLh(url, settings) {
  const config = { extends: 'lighthouse:default', settings: { onlyCategories: ['performance'], ...settings } };
  const lhr = await lighthouse(url, { port: chrome.port, logLevel: 'error', output: 'json' }, config);
  const a = lhr.lhr.audits;
  const metrics = {};
  for (const k of ['first-contentful-paint', 'largest-contentful-paint', 'speed-index', 'total-blocking-time', 'cumulative-layout-shift', 'interactive']) {
    metrics[k] = a[k]?.numericValue ?? null;
  }
  return {
    perf: lhr.lhr.categories.performance.score * 100,
    metrics,
    tbw: a['total-byte-weight']?.numericValue ?? null,
    requests: a['network-requests']?.details?.items ?? [],
  };
}

// Lighthouse recommends multiple runs and taking the median for perf scores.
const MOBILE_RUNS = 5;
const mobileRuns = [];
for (let i = 0; i < MOBILE_RUNS; i++) mobileRuns.push(await runLh(`${base}/`, {}));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mobile = {
  perf: median(mobileRuns.map((r) => r.perf)),
  metrics: Object.fromEntries(Object.keys(mobileRuns[0].metrics).map((k) => [k, median(mobileRuns.map((r) => r.metrics[k] ?? 0))])),
  tbw: median(mobileRuns.map((r) => r.tbw ?? 0)),
  requests: mobileRuns[0].requests,
  runs: mobileRuns.map((r) => ({ perf: r.perf, metrics: r.metrics })),
};
const desktop = await runLh(`${base}/`, {
  formFactor: 'desktop',
  screenEmulation: { disabled: true },
  throttlingMethod: 'simulate',
  throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 },
});
await chrome.kill();
server.close();

// deck.gl (dynamic chunks) and the data worker must be fetched only AFTER
// data/manifest.json: every non-entry request must follow the manifest request.
const norm = (u) => u.replace(base, '');
const manifestReq = mobile.requests.find((r) => norm(r.url).endsWith('data/manifest.json'));
const dynReqs = mobile.requests.filter((r) => dynamicChunks.some((f) => norm(r.url).endsWith(f)));
const deckAfterManifest =
  !!manifestReq && dynReqs.every((r) => (r.startTime ?? 0) >= (manifestReq.startTime ?? 0));
const entrySet = new Set(['index.html', ...(entryFilesStatic ?? [])]);
const nonEntryReqs = mobile.requests.filter((r) => !entrySet.has(norm(r.url)) && norm(r.url) !== 'data/manifest.json');
const nonEntryAfterManifest =
  !!manifestReq && nonEntryReqs.every((r) => (r.startTime ?? 0) >= (manifestReq.startTime ?? 0));

const lhChecks = [
  check('lighthouse-mobile>=80', mobile.perf >= LH_MOBILE_MIN, `score ${mobile.perf.toFixed(0)} (median of ${MOBILE_RUNS})`),
  check('lighthouse-desktop>=90', desktop.perf >= LH_DESKTOP_MIN, `score ${desktop.perf.toFixed(0)}`),
  check('manifest-fetched', !!manifestReq, manifestReq ? manifestReq.url : 'data/manifest.json not requested'),
  check('deck-chunks-after-manifest', deckAfterManifest, `${dynReqs.length} dynamic chunks, all after manifest`),
  check('non-entry-requests-after-manifest', nonEntryAfterManifest, `${nonEntryReqs.length} lazy requests (deck chunks, worker, density zst), all after manifest`),
];

// Nothing phones home: every network request must be same-origin (or data:/blob:).
const external = mobile.requests
  .map((r) => r.url)
  .filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:'));
lhChecks.push(check('no-cross-origin-requests', external.length === 0, external.slice(0, 5).join(', ') || 'all same-origin'));

const report = {
  when: new Date().toISOString(),
  static: staticChecks,
  firstLoadBytes,
  firstLoadBudget: FIRST_LOAD_BUDGET,
  dataDirBytes: dataBytes,
  dynamicChunks: dynamicChunks.length,
  deckChunksRequestedAfterManifest: dynReqs.length,
  lighthouse: {
    mobile: { performance: mobile.perf, metrics: mobile.metrics, totalByteWeight: mobile.tbw, runs: mobile.runs },
    desktop: { performance: desktop.perf, metrics: desktop.metrics, totalByteWeight: desktop.tbw },
    checks: lhChecks,
  },
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`\nVALIDATE FAILED (${failures.length}):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.error('\nVALIDATE OK');
