import maplibregl from 'maplibre-gl';
import { initialView } from './view';


export function createMap(container: HTMLElement): maplibregl.Map {
  const view = initialView();
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
    center: view.center,
    zoom: view.zoom,
    minZoom: 2.5,
    maxZoom: 12,
    // Wide bounds only: a tight bbox here would force maplibre to zoom in at
    // init (viewport wider than the bounds at the fitted zoom), pushing
    // Denmark off screen and breaking the initial fit.
    maxBounds: [
      [-30, 40],
      [60, 75],
    ],
    attributionControl: false, // attribution lives in the site footer
    dragRotate: false,
    pitchWithRotate: false,
    renderWorldCopies: false,
  });
}
