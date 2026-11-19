import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { attachLand } from './land';
import { attachDeck, type DeckHandle } from './deck';
import { cellsFor, loadManifest } from './data';
import { initChrome } from './ui';
import { initAnalytics } from './analytics';
import { monthKey, type State } from './state';

initAnalytics();
// Kick off the manifest fetch at module evaluation so every heavy chunk
// (maplibre, deck.gl worker, density data) is requested strictly after
// data/manifest.json — the rule that keeps the first-load bundle small.
const manifestPromise = loadManifest();

async function boot(): Promise<void> {
  const manifest = await manifestPromise;
  // MapLibre itself is a lazy chunk: the inline early-paint script in
  // index.html already draws the map, so the 800 kB maplibre bundle parses
  // off the critical path, after the manifest.
  const { createMap } = await import('./map');
  const map = createMap(document.getElementById('map')!);
  attachLand(map, document.getElementById('land') as HTMLCanvasElement);

  // deck.gl stays out of first load: the overlay attaches only after the data
  // manifest has been fetched (dynamic import into a worker), then layers are
  // fed per state.
  let deckPromise: Promise<DeckHandle> | null = null;
  const ensureDeck = (): Promise<DeckHandle> => (deckPromise ??= attachDeck(map));

  async function refresh(state: State): Promise<void> {
    if (!manifest) return; // no data yet
    const groups = state.group === 'all' ? Object.keys(manifest.groups) : [state.group];
    // start the deck.gl worker in parallel with the data fetch so its chunk
    // download/parse overlaps the data worker's decompress
    const deckP = ensureDeck();
    const density = await cellsFor(groups, monthKey(state.month));
    const deck = await deckP;
    deck.setLayers(density);
  }

  map.on('load', () => {
    const state = initChrome(manifest, (s) => void refresh(s));
    void refresh(state);
  });
}

void boot();
