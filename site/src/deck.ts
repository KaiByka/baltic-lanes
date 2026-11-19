import type maplibregl from 'maplibre-gl';
import type { DensityCells } from './data';

export interface DeckHandle {
  setLayers(density: DensityCells | null): void;
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

function currentView(map: maplibregl.Map): ViewState {
  const c = map.getCenter();
  return { longitude: c.lng, latitude: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

// Fallback renderer if the worker path is unavailable: an interleaved
// MapLibreOverlay on the main thread (deck.gl chunks then load lazily here,
// still only after data/manifest.json).
async function attachFallback(map: maplibregl.Map, canvas: HTMLCanvasElement): Promise<DeckHandle> {
  const { MapLibreOverlay } = await import('@deck.gl/maplibre');
  const { buildLayers } = await import('./layers');
  const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);
  canvas.remove();
  return {
    setLayers: (d) => void buildLayers(d).then((layers) => overlay.setProps({ layers })),
  };
}

// deck.gl is bundled at build time but loaded lazily: this function is only
// called after data/manifest.json has been fetched. Rendering happens in a
// dedicated worker (deck-worker.ts) on an OffscreenCanvas layered over the
// map, so deck.gl/luma.gl code evaluation and GL work stay off the main
// thread and the page stays interactive on a phone.
export async function attachDeck(map: maplibregl.Map): Promise<DeckHandle> {
  const container = map.getContainer();
  const canvas = document.createElement('canvas');
  canvas.className = 'deckgl-overlay';
  container.appendChild(canvas);

  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || container.clientWidth;
    const h = canvas.clientHeight || container.clientHeight;
    return { width: Math.max(1, Math.round(w * dpr)), height: Math.max(1, Math.round(h * dpr)) };
  };

  if (typeof OffscreenCanvas === 'undefined' || !canvas.transferControlToOffscreen) {
    return attachFallback(map, canvas);
  }

  let handle: DeckHandle;
  let lastDensity: DensityCells | null = null;
  const off = canvas.transferControlToOffscreen();
  const worker = new Worker(new URL('./deck-worker.ts', import.meta.url), { type: 'module' });
  let fellBack = false;
  worker.onerror = () => {
    if (fellBack) return;
    fellBack = true;
    void attachFallback(map, canvas).then((h) => {
      handle = h;
      handle.setLayers(lastDensity);
    });
  };
  const { width, height } = size();
  worker.onmessage = (e) => {
    if (e.data?.type === 'error' || e.data?.type === 'deckerror') console.error('[deck-worker]', e.data.message);
  };
  worker.postMessage({ type: 'init', canvas: off, width, height, viewState: currentView(map) }, [off]);
  // some Deck builds only construct viewports on an explicit viewState update
  worker.postMessage({ type: 'view', viewState: currentView(map), width, height });

  let raf = 0;
  const postView = () => {
    const s = size();
    worker.postMessage({ type: 'view', viewState: currentView(map), width: s.width, height: s.height });
  };
  map.on('move', () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; postView(); });
  });
  map.on('resize', postView);

  handle = {
    setLayers(density: DensityCells | null): void {
      lastDensity = density;
      if (!fellBack) worker.postMessage({ type: 'cells', density });
    },
  };
  return handle;
}
