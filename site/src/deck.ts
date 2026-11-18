import type maplibregl from 'maplibre-gl';
import type { Layer } from '@deck.gl/core';

export interface DeckHandle {
  setLayers(layers: Layer[]): void;
}

// deck.gl is bundled at build time but loaded lazily (dynamic import) so the
// first paint only pays for MapLibre. The overlay is interleaved into the
// MapLibre canvas; density data arrives per group from sprint 2 on.
export async function attachDeck(map: maplibregl.Map): Promise<DeckHandle> {
  const { MapLibreOverlay } = await import('@deck.gl/maplibre');
  const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);
  return {
    setLayers(layers: Layer[]) {
      overlay.setProps({ layers });
    },
  };
}
