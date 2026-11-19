import { SITE_ROOT, type GridInfo } from './view';

// Lazy-loaded aggregated AIS data (pipeline stage 4). The manifest is fetched
// on the main thread (it drives the chrome); the heavy zstd files are
// fetched/decompressed/parsed in a worker (see data-worker.ts) so the main
// thread never blocks on data.
export interface GroupInfo {
  file: string;
  bytes: number;
  cells: number;
}
export interface Manifest {
  version: number;
  months: string[];
  grid: GridInfo;
  groups: Record<string, GroupInfo>;
}

export interface DensityCells {
  grid: GridInfo;
  cells: [number, number, number][]; // [cellId, weight, count]; position decoded in the layer
}

let manifestPromise: Promise<Manifest | null> | null = null;
export function loadManifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch(`${SITE_ROOT}data/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return manifestPromise;
}

interface WorkerResponse {
  id: number;
  grid?: GridInfo;
  cells: [number, number, number][];
}

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, (d: DensityCells | null) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./data-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      p(e.data.grid ? { grid: e.data.grid, cells: e.data.cells } : null);
    };
    worker.onerror = () => {
      // fail all pending; next call retries with a fresh worker
      for (const p of pending.values()) p(null);
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

export function cellsFor(groups: string[], monthKey: string): Promise<DensityCells | null> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ id, groups, monthKey, siteRoot: SITE_ROOT });
  });
}
