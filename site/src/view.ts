// Shared view constants + tiny geo helpers. No maplibre import here so the
// early-paint entry (early.ts) stays tiny.

// Resolve the hosting root at runtime so the same build works at
// baltic.marespot.com/ and <user>.github.io/<repo>/ (vite base is './').
export const SITE_ROOT = new URL(import.meta.env.BASE_URL, window.location.href).pathname;

export const INITIAL_CENTER: [number, number] = [19, 58.3];
export const INITIAL_ZOOM = 3.4;

export const mercX = (lon: number): number => (lon + 180) / 360;
export const mercY = (lat: number): number => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

// Project lng/lat to screen px for the initial static view (used before the
// MapLibre map exists). Matches maplibre's web-mercator transform.
export function projectStatic(lon: number, lat: number, w: number, h: number): [number, number] {
  const worldSize = 256 * 2 ** INITIAL_ZOOM;
  const [cx, cy] = INITIAL_CENTER;
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
