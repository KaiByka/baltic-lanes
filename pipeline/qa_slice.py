#!/usr/bin/env python3
"""Sprint 2 QA: plausibility of the July 2024 slice aggregates.

Reads site/public/data (manifest + density zstd JSON) and reports where the
pleasure-craft / tanker density concentrates, plus size/determinism facts.
Run: pipeline/.venv/bin/python pipeline/qa_slice.py
"""
import json
from pathlib import Path

import zstandard

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "site" / "public" / "data"

WORLD_W = 40075016.68557849


def cell_to_lonlat(cell, ncols, cell_m):
    import math

    x = cell % ncols
    y = cell // ncols
    lon = ((x + 0.5) * cell_m / WORLD_W) * 360 - 180
    merc_y_frac = (y + 0.5) * cell_m / WORLD_W
    lat = (2 * math.atan(math.exp(2 * math.pi * (0.5 - merc_y_frac))) - math.pi / 2) * 180 / math.pi
    return lon, lat


def main():
    manifest = json.loads((DATA / "manifest.json").read_text())
    grid = manifest["grid"]
    print(f"manifest months: {manifest['months']}  groups: {sorted(manifest['groups'])}")
    total = 0
    for grp, info in sorted(manifest["groups"].items()):
        raw = zstandard.ZstdDecompressor().decompress((DATA / info["file"]).read_bytes())
        payload = json.loads(raw)
        total += info["bytes"]
        cell_m = grid["cellMeters"]
        for month, cells in payload["months"].items():
            msgs = sum(c[1] for c in cells)
            print(f"\n[{grp}] {month}: {len(cells)} cells, {msgs:,} messages, zstd {info['bytes']:,} B")
            top = sorted(cells, key=lambda c: -c[1])[:12]
            print("  top cells (lon, lat, count):")
            for cell, cnt in top:
                lon, lat = cell_to_lonlat(cell, grid["ncols"], cell_m)
                print(f"    {lon:6.2f}E {lat:5.2f}N  {cnt:>7,} msgs")
            # coastal vs open-Baltic concentration
            def in_box(c, lon0, lat0, lon1, lat1):
                lon, lat = cell_to_lonlat(c[0], grid["ncols"], cell_m)
                return lon0 <= lon <= lon1 and lat0 <= lat <= lat1

            danish = sum(c[1] for c in cells if in_box(c, 10.3, 54.4, 13.2, 56.3))  # Danish straits / Kattegat
            german = sum(c[1] for c in cells if in_box(c, 9.0, 53.8, 14.5, 55.1))  # German Baltic coast
            openbaltic = sum(c[1] for c in cells if in_box(c, 17.0, 57.5, 24.0, 60.5))  # open Baltic proper
            print(f"  messages in Danish-straits box: {danish:,} | German-coast box: {german:,} | open-Baltic box: {openbaltic:,}")
    print(f"\ntotal site data: {total / 1e6:.2f} MB (slice budget <= 10 MB)")


if __name__ == "__main__":
    main()
