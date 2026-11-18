// Generates the self-hosted basemap assets (site/public/data/basemap/*.geojson)
// from Natural Earth 50m land (public domain), clipped to the Baltic bbox.
// The site paints these on a 2D canvas underlay beneath the MapLibre canvas
// (cheap to render; vector layers under software GL are slow).
// Deterministic: same input -> same output bytes. Re-run with: npm run basemap
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NE_LAND_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';
// Baltic bbox with margin; the AIS data bbox is lon 9-31, lat 53-66 (docs/pipeline.md).
export const BBOX = { minLon: 6, minLat: 52, maxLon: 34, maxLat: 67.5 };
const PRECISION = 4; // ~11 m at these latitudes
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/basemap');
const GENERATOR = 'site/scripts/build-basemap.mjs (Natural Earth 50m land, public domain)';

const round = (v) => Math.round(v * 10 ** PRECISION) / 10 ** PRECISION;
const roundRing = (ring) => ring.map(([lon, lat]) => [round(lon), round(lat)]);

function clipRing(ring) {
  // Sutherland-Hodgman against the 4 bbox edges.
  const edges = [
    { inside: (p) => p[0] >= BBOX.minLon, hit: (a, b) => [BBOX.minLon, a[1] + ((b[1] - a[1]) * (BBOX.minLon - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= BBOX.maxLon, hit: (a, b) => [BBOX.maxLon, a[1] + ((b[1] - a[1]) * (BBOX.maxLon - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= BBOX.minLat, hit: (a, b) => [a[0] + ((b[0] - a[0]) * (BBOX.minLat - a[1])) / (b[1] - a[1]), BBOX.minLat] },
    { inside: (p) => p[1] <= BBOX.maxLat, hit: (a, b) => [a[0] + ((b[0] - a[0]) * (BBOX.maxLat - a[1])) / (b[1] - a[1]), BBOX.maxLat] },
  ];
  let pts = ring;
  for (const e of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const curIn = e.inside(cur);
      const nextIn = e.inside(next);
      if (curIn !== nextIn) out.push(e.hit(cur, next));
      if (nextIn) out.push(next);
    }
    pts = out;
    if (pts.length === 0) break;
  }
  if (pts.length >= 3 && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) {
    pts.push([...pts[0]]);
  }
  return pts.length >= 4 ? pts : null;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a / 2);
}

function clipPolygon(polygon) {
  const outer = clipRing(polygon[0]);
  if (!outer || ringArea(outer) < 1e-7) return null;
  const rings = [roundRing(outer)];
  for (const hole of polygon.slice(1)) {
    const h = clipRing(hole);
    if (h && ringArea(h) > 1e-9) rings.push(roundRing(h));
  }
  return rings;
}

function graticuleLines() {
  const lines = [];
  for (let lon = Math.ceil(BBOX.minLon / 2) * 2; lon <= BBOX.maxLon; lon += 2) {
    lines.push([
      [lon, BBOX.minLat],
      [lon, BBOX.maxLat],
    ]);
  }
  for (let lat = Math.ceil(BBOX.minLat / 2) * 2; lat <= BBOX.maxLat; lat += 2) {
    lines.push([
      [BBOX.minLon, lat],
      [BBOX.maxLon, lat],
    ]);
  }
  return lines;
}

const res = await fetch(NE_LAND_URL);
if (!res.ok) throw new Error(`Natural Earth fetch failed: ${res.status} ${res.statusText}`);
const ne = await res.json();

const polys = [];
let dropped = 0;
for (const f of ne.features) {
  const g = f.geometry;
  if (!g) continue;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const p of polygons) {
    const clipped = clipPolygon(p);
    if (clipped) polys.push(clipped);
    else dropped++;
  }
}

const land = {
  type: 'FeatureCollection',
  generator: GENERATOR,
  bbox: [BBOX.minLon, BBOX.minLat, BBOX.maxLon, BBOX.maxLat],
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } }],
};
const graticule = {
  type: 'FeatureCollection',
  generator: GENERATOR,
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: graticuleLines() } }],
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'land.geojson'), JSON.stringify(land));
await writeFile(path.join(OUT_DIR, 'graticule.geojson'), JSON.stringify(graticule));
console.log(`basemap written to ${OUT_DIR}: ${polys.length} polys kept, ${dropped} dropped, land.geojson ${(JSON.stringify(land).length / 1024).toFixed(1)} KB`);
