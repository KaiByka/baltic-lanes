import type maplibregl from 'maplibre-gl';
import { SITE_ROOT, basemap, initialView, type Ring } from './view';

// After the MapLibre map exists, redraw the land underlay with exact map
// projections on every move (the inline script in index.html painted the
// static initial view).
const LAND_FILL = '#16222f';
const LAND_STROKE = '#2c4257';
const GRATICULE = '#101f30';

export function attachLand(map: maplibregl.Map, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  let polys: Ring[][] = [];
  let lines: Ring[] = [];

  // Skip no-op redraws: the inline early-paint script already drew the
  // initial view, and repainting the (largest) canvas at map-init time would
  // push Largest Contentful Paint out to when the maplibre bundle finishes.
  const v0 = initialView();
  let lastKey = `${v0.center[0].toFixed(6)},${v0.center[1].toFixed(6)},${v0.zoom.toFixed(6)},${canvas.clientWidth}x${canvas.clientHeight}`;
  const draw = () => {
    const c = map.getCenter();
    const key = `${c.lng.toFixed(6)},${c.lat.toFixed(6)},${map.getZoom().toFixed(6)},${canvas.clientWidth}x${canvas.clientHeight}`;
    if (key === lastKey) return;
    lastKey = key;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const p = map.project(ring[i]);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      }
    }
    ctx.fillStyle = LAND_FILL;
    ctx.fill('evenodd');
    ctx.strokeStyle = LAND_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const p = map.project(line[i]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    }
    ctx.strokeStyle = GRATICULE;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  };

  const load = async () => {
    const inline = basemap();
    if (inline) {
      polys = inline.land.features[0].geometry.coordinates;
      lines = inline.grat.features[0].geometry.coordinates;
    } else {
      const [land, grat] = await Promise.all([
        fetch(`${SITE_ROOT}data/basemap/land.geojson`).then((r) => r.json()),
        fetch(`${SITE_ROOT}data/basemap/graticule.geojson`).then((r) => r.json()),
      ]);
      polys = land.features[0].geometry.coordinates;
      lines = grat.features[0].geometry.coordinates;
    }
    // No draw() here: the inline early-paint script already drew the initial
    // view (same center/zoom), and repainting on load would reset LCP.
  };

  map.on('move', draw);
  map.on('resize', draw);
  map.on('load', () => void load());
  void load();
}
