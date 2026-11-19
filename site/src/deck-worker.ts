// deck.gl runs INSIDE this worker, rendering into an OffscreenCanvas that the
// main thread transferred from a <canvas> layered over the map. All deck.gl /
// luma.gl code evaluation and GL work happens off the main thread, so the
// page stays interactive on a phone while the density layer renders.
// The worker (and therefore the deck.gl chunks) is only created after
// data/manifest.json has been fetched (main.ts), keeping deck.gl out of the
// first-load bundle.
import { Deck, MapView } from '@deck.gl/core';
import { buildLayers } from './layers';
import type { DensityCells } from './data';

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

interface InitMsg {
  type: 'init';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  viewState: ViewState;
}
interface ViewMsg {
  type: 'view';
  viewState: ViewState;
  width: number;
  height: number;
}
interface CellsMsg {
  type: 'cells';
  density: DensityCells | null;
}
type Msg = InitMsg | ViewMsg | CellsMsg;

let deck: Deck<MapView> | null = null;
let pendingCells: DensityCells | null = null;

// Minimal DOM polyfill: deck.gl's widget/view code touches `document` and
// element `style`/`classList` even when rendering into an OffscreenCanvas.
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  const fakeEl = (): Record<string, unknown> => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, removeChild() {}, insertBefore() {}, append() {}, prepend() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute: () => null,
    closest: () => null, getRootNode: () => ({}),
    querySelector: () => null, querySelectorAll: () => [],
    clientWidth: 0, clientHeight: 0,
  });
  (globalThis as Record<string, unknown>).document = {
    createElement: fakeEl,
    createElementNS: fakeEl,
    body: fakeEl(),
    documentElement: fakeEl(),
  };
}

async function applyCells(density: DensityCells | null): Promise<void> {
  pendingCells = density;
  if (!deck) return;
  deck.setProps({ layers: await buildLayers(density) });
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const canvas = m.canvas as OffscreenCanvas & { style?: object; closest?: () => null };
      canvas.width = m.width;
      canvas.height = m.height;
      // deck.gl's canvas path expects a DOM canvas (`canvas.style`,
      // `canvas.closest`); OffscreenCanvas has neither. Patch both so Deck can
      // run in this worker.
      if (!('style' in canvas)) Object.defineProperty(canvas, 'style', { value: {}, configurable: true });
      if (typeof canvas.closest !== 'function') canvas.closest = () => null;
      deck = new Deck({
        canvas: canvas as unknown as HTMLCanvasElement,
        width: m.width,
        height: m.height,
        useDevicePixels: false,
        views: new MapView({ repeat: false }),
        controller: false,
        initialViewState: m.viewState,
        layers: [],
        onError: (err: Error) => postMessage({ type: 'deckerror', message: String(err?.stack ?? err) }),
      });
      if (pendingCells) void applyCells(pendingCells);
      postMessage({ type: 'ready' });
    } catch (err) {
      postMessage({ type: 'error', message: String((err as Error).stack ?? err) });
      throw err; // also triggers main-thread fallback via worker.onerror
    }
  } else if (m.type === 'view' && deck) {
    const c = (deck as unknown as { canvas?: OffscreenCanvas }).canvas;
    if (c && (c.width !== m.width || c.height !== m.height)) { c.width = m.width; c.height = m.height; }
    deck.setProps({ viewState: m.viewState, width: m.width, height: m.height });
  } else if (m.type === 'cells') {
    void applyCells(m.density);
  }
};
