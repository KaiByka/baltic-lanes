import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { createMap } from './map';
import { SITE_ROOT } from './view';
import { attachLand } from './land';
import { attachDeck, type DeckHandle } from './deck';
import { buildLayers } from './layers';
import { initChrome } from './ui';
import { renderFooter } from './footer';
import { initAnalytics } from './analytics';
import { parseHash, type State } from './state';

initAnalytics();
renderFooter();

const map = createMap(document.getElementById('map')!);
attachLand(map, document.getElementById('land') as HTMLCanvasElement);

// Data manifest: emitted by the pipeline (sprint 2+). Until it exists there is
// no data to show, so the deck.gl overlay stays unattached and the chrome
// stays disabled.
let manifestPromise: Promise<unknown | null> | null = null;
function fetchManifest(): Promise<unknown | null> {
  manifestPromise ??= fetch(`${SITE_ROOT}data/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return manifestPromise;
}

let deckPromise: Promise<DeckHandle> | null = null;
function ensureDeck(): Promise<DeckHandle> {
  deckPromise ??= attachDeck(map);
  return deckPromise;
}

async function refresh(state: State): Promise<void> {
  const manifest = await fetchManifest();
  if (!manifest) return; // no data yet (sprint 1)
  const deck = await ensureDeck();
  deck.setLayers(await buildLayers(state));
}

initChrome((state) => void refresh(state));
map.on('load', () => void refresh(parseHash()));
