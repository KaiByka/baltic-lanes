import type { Color, Layer } from '@deck.gl/core';
import { cellToLonLat } from './view';
import type { DensityCells } from './data';

// Dark-theme ramp: deep blue -> cyan -> warm peak.
const COLOR_RANGE: Color[] = [
  [8, 28, 46],
  [15, 58, 95],
  [27, 108, 168],
  [46, 196, 182],
  [255, 209, 102],
];

// GridLayer is dynamically imported (see deck.ts) so deck.gl stays out of the
// first-load bundle; it attaches only after data/manifest.json is fetched.
// Cells arrive pre-binned for rendering (see data-worker.ts); cellSize
// matches that lattice.
export async function buildLayers(density: DensityCells | null): Promise<Layer[]> {
  const { GridLayer } = await import('@deck.gl/aggregation-layers');
  const grid = density?.grid;
  return [
    new GridLayer({
      id: 'density',
      data: density?.cells ?? [],
      cellSize: grid?.cellMeters ?? 16000,
      getPosition: (d: [number, number, number]) => (grid ? cellToLonLat(d[0], grid) : [0, 0]),
      getWeight: (d: [number, number, number]) => d[1],
      colorRange: COLOR_RANGE,
      opacity: 0.9,
      extruded: false,
      pickable: false,
      // CPU aggregation: with few pre-binned cells this is faster than the
      // GPU FBO path, which is very slow under software GL (headless CI).
      gpuAggregation: false,
    }),
  ];
}
