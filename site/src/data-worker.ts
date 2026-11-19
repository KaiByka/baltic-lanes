// Data worker: fetches + decompresses + parses + merges + bins the density
// files OFF the main thread, so first paint / interaction never blocks on
// data processing. Created only after data/manifest.json is fetched (main.ts).
import { decompress } from 'fzstd';
import { cellToLonLat, type GridInfo } from './view';

interface GroupFile {
  group: string;
  grid: GridInfo;
  months: Record<string, [number, number, number, number][]>;
}

// Render cells are coarser than the stored grid: the worker pre-bins the
// stored cells into 16 km render cells, which keeps the deck.gl layer small
// enough to render in well under a second on a phone GPU.
const RENDER_CELL_M = 16000;
const cache = new Map<string, GroupFile>();

async function loadGroup(siteRoot: string, group: string): Promise<GroupFile | null> {
  const cached = cache.get(group);
  if (cached) return cached;
  const manifest = await fetch(`${siteRoot}data/manifest.json`).then((r) => r.json());
  const info = manifest.groups[group];
  if (!info) return null;
  const buf = await fetch(`${siteRoot}data/${info.file}`).then((r) => r.arrayBuffer());
  const file = JSON.parse(new TextDecoder().decode(decompress(new Uint8Array(buf)))) as GroupFile;
  cache.set(group, file);
  return file;
}

self.onmessage = async (e: MessageEvent<{ id: number; groups: string[]; monthKey: string; siteRoot: string }>) => {
  const { id, groups, monthKey, siteRoot } = e.data;
  const files = await Promise.all(groups.map((g) => loadGroup(siteRoot, g)));
  const merged = new Map<number, number>();
  let grid: GridInfo | null = null;
  for (const f of files) {
    if (!f) continue;
    grid = f.grid;
    const cells = f.months[monthKey];
    if (!cells) continue;
    const ncols = grid.ncols;
    const bin = RENDER_CELL_M / grid.cellMeters;
    const binNcols = Math.ceil(ncols / bin);
    for (const [cell, count] of cells) {
      const x = Math.floor((cell % ncols) / bin);
      const y = Math.floor(Math.floor(cell / ncols) / bin);
      const b = y * binNcols + x;
      merged.set(b, (merged.get(b) ?? 0) + count);
    }
  }
  if (!grid) {
    self.postMessage({ id, cells: [] });
    return;
  }
  const bin = RENDER_CELL_M / grid.cellMeters;
  const renderGrid: GridInfo = { ...grid, cellMeters: RENDER_CELL_M, ncols: Math.ceil(grid.ncols / bin) };
  const cells: [number, number, number][] = []; // [cell, weight, count]
  for (const [cell, count] of merged) {
    cells.push([cell, Math.log1p(count), count]);
  }
  self.postMessage({ id, grid: renderGrid, cells });
};

// re-export so the worker bundle keeps view.ts helpers (cellToLonLat unused here
// but kept for future per-cell tooltip data)
void cellToLonLat;
