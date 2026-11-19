// Shared view constants + tiny geo helpers. No maplibre import here so the
// early-paint entry (early.ts) stays tiny.

// Resolve the hosting root at runtime so the same build works at
// baltic.marespot.com/ and <user>.github.io/<repo>/ (vite base is './').
// This module is also bundled into the data worker, where `window` does not
// exist — keep every window access behind a guard or a lazy function.
export const SITE_ROOT =
  typeof window === 'undefined' ? '/' : new URL(import.meta.env.BASE_URL, window.location.href).pathname;

// Baltic bbox used for the basemap and the initial fit (matches
// scripts/build-basemap.mjs BBOX).
export const BASEMAP_BBOX: [number, number, number, number] = [6, 52, 34, 67.5];

export const mercX = (lon: number): number => (lon + 180) / 360;
export const mercY = (lat: number): number => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

// Initial view = the Baltic bbox fitted to the viewport (maplibre world is
// 512 px at zoom 0), so the sea fills the screen on any device.
export function fitView(w: number, h: number, padding = 24): { center: [number, number]; zoom: number } {
  const [minLon, minLat, maxLon, maxLat] = BASEMAP_BBOX;
  const dLon = maxLon - minLon;
  const myTop = mercY(maxLat);
  const myBot = mercY(minLat);
  const dMercY = myBot - myTop;
  const zLon = Math.log2(((w - 2 * padding) * 360) / (dLon * 512));
  const zLat = Math.log2((h - 2 * padding) / (dMercY * 512));
  const zoom = Math.min(zLon, zLat, 12);
  const centerLat = (2 * Math.atan(Math.exp(2 * Math.PI * (0.5 - (myTop + dMercY / 2)))) - Math.PI / 2) * (180 / Math.PI);
  return { center: [(minLon + maxLon) / 2, centerLat], zoom };
}

// Lazily computed (main thread only — the worker imports this module too).
let cachedInitial: { center: [number, number]; zoom: number } | null = null;
export function initialView(): { center: [number, number]; zoom: number } {
  cachedInitial ??= fitView(window.innerWidth, window.innerHeight);
  return cachedInitial;
}

// Project lng/lat to screen px for the initial static view (used before the
// MapLibre map exists). Matches maplibre's web-mercator transform, whose world
// is 512 px wide at zoom 0 (maplibre uses 512 px tiles).
export function projectStatic(lon: number, lat: number, w: number, h: number): [number, number] {
  const { center, zoom } = initialView();
  const worldSize = 512 * 2 ** zoom;
  const [cx, cy] = center;
  return [
    (mercX(lon) - mercX(cx)) * worldSize + w / 2,
    (mercY(lat) - mercY(cy)) * worldSize + h / 2,
  ];
}

// Basemap GeoJSON inlined into index.html at build time (vite plugin) so the
// early paint needs no fetch. Falls back to fetching the files if absent.
export type Ring = [number, number][];
export interface BasemapData {
  land: { features: [{ geometry: { coordinates: Ring[][] } }] };
  grat: { features: [{ geometry: { coordinates: Ring[] } }] };
}
export function basemap(): BasemapData | null {
  return (window as unknown as { __BASEMAP__?: BasemapData }).__BASEMAP__ ?? null;
}

// ---- density grid (pipeline stage 4: 1 km web-mercator cells) ----
export interface GridInfo {
  cellMeters: number;
  bbox: [number, number, number, number];
  ncols: number;
  worldWidthM: number;
}

// Inverse of the pipeline's cell id: id = cellY * ncols + cellX over a 1 km
// web-mercator lattice measured in meters from the world's top-left corner.
// Returns the cell center as [lon, lat].
export function cellToLonLat(cell: number, g: GridInfo): [number, number] {
  const x = cell % g.ncols;
  const y = Math.floor(cell / g.ncols);
  const W = g.worldWidthM;
  const c = g.cellMeters;
  const lon = (((x + 0.5) * c) / W) * 360 - 180;
  const mercYfrac = ((y + 0.5) * c) / W;
  const lat = (2 * Math.atan(Math.exp(2 * Math.PI * (0.5 - mercYfrac))) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}
