import maplibregl from 'maplibre-gl';
import { INITIAL_CENTER, INITIAL_ZOOM } from './view';

// Must match BBOX in scripts/build-basemap.mjs (the land underlay covers
// exactly this bbox).
const BBOX = { minLon: 6, minLat: 52, maxLon: 34, maxLat: 67.5 };

export function createMap(container: HTMLElement): maplibregl.Map {
  return new maplibregl.Map({
    container,
    style: {
      // Layer-less, transparent style: the sea color is the #map CSS
      // background and land/graticule are painted by the 2D canvas underlay
      // (src/early.ts, then src/land.ts). No API keys, no external tiles, and
      // no extra GL programs (vector/raster layers are slow to compile under
      // software rendering).
      version: 8,
      name: 'baltic-lanes-dark',
      sources: {},
      layers: [],
    },
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: 2.5,
    maxZoom: 12,
    maxBounds: [
      [BBOX.minLon - 1.5, BBOX.minLat - 1],
      [BBOX.maxLon + 1.5, BBOX.maxLat + 1],
    ],
    attributionControl: false, // attribution lives in the site footer
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: false,
  });
}
