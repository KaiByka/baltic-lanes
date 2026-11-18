import type { Color, Layer } from '@deck.gl/core';
import type { State } from './state';

// Dark-theme ramp: deep blue -> cyan -> warm peak.
const COLOR_RANGE: Color[] = [
  [8, 28, 46],
  [15, 58, 95],
  [27, 108, 168],
  [46, 196, 182],
  [255, 209, 102],
];

// Sprint 1: no AIS data yet. The GridLayer is wired into the deck.gl overlay
// (see deck.ts) so sprint 2 only has to point `data` at the per-group monthly
// JSON. Empty data renders nothing. GridLayer is imported dynamically to keep
// it out of the first-load bundle.
export async function buildLayers(_state: State): Promise<Layer[]> {
  const { GridLayer } = await import('@deck.gl/aggregation-layers');
  return [
    new GridLayer({
      id: 'density',
      data: [],
      cellSize: 1000, // 1 km web-mercator grid (docs/pipeline.md stage 4)
      getPosition: (d: { position: [number, number] }) => d.position,
      getWeight: (d: { weight: number }) => d.weight,
      colorRange: COLOR_RANGE,
      opacity: 0.9,
      extruded: false,
      pickable: false,
    }),
  ];
}
