#!/usr/bin/env python3
"""Baltic Lanes data pipeline — sprint 2 slice: July 2024 only (docs/pipeline.md stages 1-4).

Stages:
  1 mirror     download the daily zips for the configured months into the mirror dir
                (OUTSIDE the repo), verify CRC + CSV header, write a sha256 manifest
  2 normalize  CSV -> Parquet per day (fixed 26-column schema), with the Stage 2 QA gates:
                mandatory Baltic bbox filter, Base Station/AtoN drop (logged), loose MMSI
                gate (length 4-9), dedup on (MMSI, Timestamp)
  3 classify   MMSI -> group table (pipeline/output/mmsi_group.csv, committed)
  4 aggregate  tanker + pleasure -> 1 km web-mercator monthly grid -> zstd JSON per group
                under site/public/data/density/, plus data/manifest.json and a sha256
                anchor of everything under site/public/data (determinism gate)

Deterministic: same mirror input -> same output bytes (no wall-clock values in outputs).

Env:
  BALTIC_AIS_MIRROR  raw mirror + working dir (default /home/ivo/ais-mirror)
"""
from __future__ import annotations

import calendar
import hashlib
import io
import json
import math
import os
import sys
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb

REPO = Path(__file__).resolve().parent.parent
MIRROR = Path(os.environ.get("BALTIC_AIS_MIRROR", "/home/ivo/ais-mirror"))
RAW = MIRROR / "raw"
WORK = MIRROR / "work"
SITE_DATA = REPO / "site" / "public" / "data"
OUT = REPO / "pipeline" / "output"

BUCKET = "http://aisdata.ais.dk.s3.eu-central-1.amazonaws.com"
SLICE_MONTHS = ["2024-07"]
AGGREGATE_GROUPS = ["tanker", "pleasure"]

BBOX = (9.0, 53.0, 31.0, 66.0)  # lon_min, lat_min, lon_max, lat_max (docs/pipeline.md stage 2)
# 4 km web-mercator grid cells. Coarsened from the spec's 1 km under AGENTS.md
# rule 3 ("if the aggregate exceeds the budget, coarsen the grid"): the 1-2 km
# slice pushed first-load bytes and Lighthouse mobile TTI past the rule-8
# perf gate. NCOLS must stay consistent with CELL_M (it is the cell-id stride
# AND the decode modulus in the frontend).
CELL_M = 4000
WORLD_W_M = 40075016.68557849  # web-mercator world width in meters
NCOLS = math.ceil(WORLD_W_M / CELL_M)
DROP_MOBILE = ("Base Station", "AtoN")

# Verified canonical schema (docs/pipeline.md §Source): comma delim, '#' header, 26 cols.
EXPECTED_HEADER = (
    "# Timestamp,Type of mobile,MMSI,Latitude,Longitude,Navigational status,ROT,SOG,COG,"
    "Heading,IMO,Callsign,Name,Ship type,Cargo type,Width,Length,Type of position fixing device,"
    "Draught,Destination,ETA,Data source type,A,B,C,D"
)
COLS = [
    "Timestamp", "Type of mobile", "MMSI", "Latitude", "Longitude", "Navigational status",
    "ROT", "SOG", "COG", "Heading", "IMO", "Callsign", "Name", "Ship type", "Cargo type",
    "Width", "Length", "Type of position fixing device", "Draught", "Destination", "ETA",
    "Data source type", "A", "B", "C", "D",
]
NUMERIC = {"Latitude", "Longitude", "ROT", "SOG", "COG", "Heading", "Width", "Length", "Draught", "A", "B", "C", "D"}
COLSPEC = ",".join(f"'{c}':'VARCHAR'" for c in COLS)


def log(msg: str) -> None:
    print(f"[pipeline] {msg}", flush=True)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- stage 1
def day_files(month: str) -> list[tuple[str, Path]]:
    y, m = month.split("-")
    ndays = calendar.monthrange(int(y), int(m))[1]
    out = []
    for d in range(1, ndays + 1):
        name = f"aisdk-{y}-{m}-{d:02d}.zip"
        out.append((f"{y}/{name}", RAW / y / name))
    return out


def download_one(key: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(f"{BUCKET}/{key}") as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 22)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)


def verify_zip(path: Path) -> str:
    """CRC-test the zip, check the CSV header line, return sha256."""
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad is not None:
            raise RuntimeError(f"CRC failure in {path}: {bad}")
        members = [n for n in z.namelist() if n.endswith(".csv")]
        if len(members) != 1:
            raise RuntimeError(f"{path}: expected 1 csv member, got {members}")
        with z.open(members[0]) as f:
            first = io.TextIOWrapper(f, encoding="utf-8").readline().rstrip("\r\n")
    if first != EXPECTED_HEADER:
        raise RuntimeError(f"{path}: CSV header mismatch.\nExpected: {EXPECTED_HEADER}\nFound:    {first}")
    return sha256_file(path)


def stage1_mirror(month: str) -> dict:
    manifest_path = MIRROR / f"manifest-{month}.json"
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    files = day_files(month)
    todo = [(k, p) for k, p in files if not p.exists()]
    log(f"stage 1: {len(files)} files for {month}, {len(todo)} to download")
    if todo:
        with ThreadPoolExecutor(max_workers=4) as ex:
            list(ex.map(lambda kp: download_one(*kp), todo))
    for key, path in files:
        if key not in manifest:
            manifest[key] = {"sha256": verify_zip(path), "bytes": path.stat().st_size}
            log(f"  verified {key} sha256={manifest[key]['sha256'][:12]}…")
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    log(f"stage 1: manifest written ({manifest_path}), {len(manifest)} files")
    return manifest


# ---------------------------------------------------------------- stage 2
def con() -> duckdb.DuckDBPyConnection:
    c = duckdb.connect()
    c.execute("SET threads=4")
    c.execute("SET memory_limit='5GB'")
    c.execute(f"SET temp_directory='{WORK}/tmp'")
    (WORK / "tmp").mkdir(parents=True, exist_ok=True)
    return c


def clean(col: str) -> str:
    return f"nullif(nullif(nullif(trim(\"{col}\"), ''), 'Unknown'), 'Undefined')"


def stage2_normalize(month: str, manifest: dict) -> Path:
    """One parquet per day under WORK/parquet/<year>/; returns the parquet dir."""
    y = month.split("-")[0]
    pq_dir = WORK / "parquet" / y
    pq_dir.mkdir(parents=True, exist_ok=True)
    qa = {"month": month, "days": {}}
    for key, path in day_files(month):
        day = key.rsplit("-", 1)[-1].replace(".zip", "")
        pq = pq_dir / f"aisdk-{y}-{month.split('-')[1]}-{day}.parquet"
        csv_tmp = WORK / f"{path.stem}.csv"
        if pq.exists():
            log(f"stage 2: {pq.name} exists, skipping")
            continue
        log(f"stage 2: extracting {path.name}")
        with zipfile.ZipFile(path) as z:
            member = [n for n in z.namelist() if n.endswith(".csv")][0]
            with z.open(member) as src, open(csv_tmp, "wb") as dst:
                while True:
                    chunk = src.read(1 << 24)
                    if not chunk:
                        break
                    dst.write(chunk)
        c = con()
        c.execute(
            f"CREATE OR REPLACE VIEW raw AS SELECT * FROM read_csv('{csv_tmp}', header=false, skip=1, "
            f"delim=',', quote='\"', escape='\"', auto_detect=false, strict_mode=false, null_padding=true, "
            f"columns={{{COLSPEC}}})"
        )
        selects = []
        for col in COLS:
            if col == "Timestamp":
                selects.append(f"strptime(\"{col}\", '%d/%m/%Y %H:%M:%S') AS \"{col}\"")  # naive = UTC assumption
            elif col in NUMERIC:
                selects.append(f"try_cast({clean(col)} AS DOUBLE) AS \"{col}\"")
            else:
                selects.append(f"{clean(col)} AS \"{col}\"")
        select_all = ", ".join(selects)
        lon_min, lat_min, lon_max, lat_max = BBOX
        c.execute(f"CREATE OR REPLACE TABLE typed AS SELECT {select_all} FROM raw")
        c.execute(
            f"""
            CREATE OR REPLACE TABLE clean AS
            SELECT * EXCLUDE (in_bbox) FROM (
              SELECT *, ("Latitude" BETWEEN {lat_min} AND {lat_max}) AND ("Longitude" BETWEEN {lon_min} AND {lon_max}) AS in_bbox
              FROM typed
            )
            WHERE in_bbox
              AND "Type of mobile" NOT IN ('Base Station', 'AtoN')
              AND length("MMSI") BETWEEN 4 AND 9
            """
        )
        # dedup on (MMSI, Timestamp)
        c.execute(
            f"""
            CREATE OR REPLACE TABLE dedup AS
            SELECT * FROM (SELECT *, row_number() OVER (PARTITION BY "MMSI", "Timestamp" ORDER BY "MMSI") rn FROM clean) WHERE rn = 1
            """
        )
        stats = {
            "raw_rows": c.execute("SELECT count(*) FROM raw").fetchone()[0],
            "out_of_bbox_dropped": c.execute(
                f"SELECT count(*) FROM typed WHERE NOT (\"Latitude\" BETWEEN {lat_min} AND {lat_max} AND \"Longitude\" BETWEEN {lon_min} AND {lon_max})"
            ).fetchone()[0],
            "mobile_dropped": c.execute(
                f"SELECT count(*) FROM typed WHERE \"Type of mobile\" IN ('Base Station', 'AtoN')"
            ).fetchone()[0],
            "after_filters": c.execute("SELECT count(*) FROM clean").fetchone()[0],
            "after_dedup": c.execute("SELECT count(*) FROM dedup").fetchone()[0],
            "zero_out_of_bbox_after_filter": c.execute(
                f"SELECT count(*) = 0 FROM dedup WHERE NOT (\"Latitude\" BETWEEN {lat_min} AND {lat_max}) OR NOT (\"Longitude\" BETWEEN {lon_min} AND {lon_max})"
            ).fetchone()[0],
            "ts_min": str(c.execute('SELECT min("Timestamp") FROM dedup').fetchone()[0]),
            "ts_max": str(c.execute('SELECT max("Timestamp") FROM dedup').fetchone()[0]),
        }
        c.execute(f"COPY (SELECT * FROM dedup) TO '{pq}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        qa["days"][day] = stats
        log(f"stage 2: {pq.name} raw={stats['raw_rows']} bbox_dropped={stats['out_of_bbox_dropped']} mobile_dropped={stats['mobile_dropped']} final={stats['after_dedup']}")
        csv_tmp.unlink()
        c.close()
    (WORK / f"qa-normalize-{month}.json").write_text(json.dumps(qa, indent=1, sort_keys=True) + "\n")
    return pq_dir


# ---------------------------------------------------------------- stage 3
GROUP_CASE = """
CASE stype
  WHEN 'Tanker' THEN 'tanker'
  WHEN 'Cargo' THEN 'cargo'
  WHEN 'Passenger' THEN CASE WHEN length > 150 THEN 'cruise' ELSE 'ferry' END
  WHEN 'Fishing' THEN 'fishing'
  WHEN 'Sailing' THEN 'pleasure'
  WHEN 'Pleasure' THEN 'pleasure'
  ELSE 'other'
END
"""


def stage3_classify(pq_dir: Path) -> Path:
    c = con()
    c.execute(
        f"""
        CREATE OR REPLACE TABLE mmsi_map AS
        WITH s AS (
          SELECT "MMSI" AS mmsi,
                 mode("Ship type") FILTER (WHERE "Ship type" IS NOT NULL AND "Ship type" NOT IN ('Undefined','Unknown')) AS stype,
                 max("Length") AS length
          FROM read_parquet('{pq_dir}/*.parquet')
          GROUP BY 1
        )
        SELECT mmsi, {GROUP_CASE} AS grp FROM s
        """
    )
    OUT.mkdir(parents=True, exist_ok=True)
    csv_path = OUT / "mmsi_group.csv"
    c.execute(f"COPY (SELECT mmsi, grp FROM mmsi_map ORDER BY mmsi) TO '{csv_path}' (HEADER, DELIMITER ',')")
    dist = c.execute("SELECT grp, count(*) FROM mmsi_map GROUP BY 1 ORDER BY 1").fetchall()
    log(f"stage 3: mmsi_group.csv written ({csv_path.stat().st_size} bytes), groups: {dist}")
    c.close()
    return csv_path


# ---------------------------------------------------------------- stage 4
def cell_expr() -> str:
    # web-mercator meters from the top-left corner of the world:
    #   mercX_m = (lon+180)/360*W ; mercY_m = (0.5 - ln(tan(pi/4+lat*pi/360))/(2pi))*W
    # cell id = cellY * NCOLS + cellX
    return f"""
      CAST(floor(((0.5 - ln(tan(pi()/4 + ("Latitude"*pi()/360)))/(2*pi()))*{WORLD_W_M}) / {CELL_M}) AS BIGINT) * {NCOLS}
      + CAST(floor((("Longitude" + 180.0)/360.0*{WORLD_W_M}) / {CELL_M}) AS BIGINT)
    """


def stage4_aggregate(pq_dir: Path, mmsi_csv: Path, month: str) -> dict:
    import zstandard

    c = con()
    c.execute(
        f"CREATE OR REPLACE VIEW mmsi_map AS SELECT mmsi, grp FROM read_csv('{mmsi_csv}', header=true, "
        "columns={'mmsi':'VARCHAR','grp':'VARCHAR'}, auto_detect=false)"
    )
    c.execute(
        f"""
        CREATE OR REPLACE VIEW pts AS
        SELECT p.*, g.grp AS grp,
               {cell_expr()} AS cell,
               strftime(p."Timestamp", '%Y-%m') AS month
        FROM read_parquet('{pq_dir}/*.parquet') p
        JOIN mmsi_map g ON p."MMSI" = g.mmsi
        """
    )
    density_dir = SITE_DATA / "density"
    density_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1,
        "months": sorted({month}),
        "grid": {"cellMeters": CELL_M, "bbox": list(BBOX), "ncols": NCOLS, "worldWidthM": WORLD_W_M},
        "groups": {},
        "source": {"archive": "http://aisdata.ais.dk/", "license": "aggregates only"},
    }
    for grp in AGGREGATE_GROUPS:
        # [cell, message count] only: the frontend renders density from counts;
        # per-cell vessel/SOG stats stay out of the shipped payload (byte
        # budget — AGENTS.md rule 3) and Name/Callsign never leave stage 2.
        rows = c.execute(
            f"SELECT month, cell, count(*) AS cnt "
            f"FROM pts WHERE grp = '{grp}' GROUP BY 1, 2 ORDER BY 2"
        ).fetchall()
        months: dict[str, list] = {}
        for m, cell, cnt in rows:
            months.setdefault(m, []).append([cell, cnt])
        payload = {"group": grp, "grid": manifest["grid"], "months": months}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        zst = zstandard.ZstdCompressor(level=19).compress(raw)
        f = density_dir / f"{grp}.json.zst"
        f.write_bytes(zst)
        manifest["groups"][grp] = {"file": f"density/{grp}.json.zst", "bytes": len(zst), "cells": sum(len(v) for v in months.values())}
        log(f"stage 4: {f.name} {len(zst)} bytes zstd ({len(raw)} raw), cells={sum(len(v) for v in months.values())}")
    manifest_path = SITE_DATA / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    log(f"stage 4: manifest.json written ({manifest_path})")
    c.close()
    return manifest


def write_anchor() -> Path:
    """sha256 of every file under site/public/data — the determinism/no-hand-edits gate."""
    OUT.mkdir(parents=True, exist_ok=True)
    anchor = {}
    for p in sorted(SITE_DATA.rglob("*")):
        if p.is_file():
            anchor[str(p.relative_to(SITE_DATA))] = sha256_file(p)
    path = OUT / "data.sha256.json"
    path.write_text(json.dumps(anchor, indent=1, sort_keys=True) + "\n")
    log(f"anchor: {len(anchor)} files hashed -> {path}")
    return path


def main() -> None:
    (MIRROR / "raw").mkdir(parents=True, exist_ok=True)
    # BALTIC_PIPELINE_ONLY_AGGREGATE=1: skip mirror/normalize, reuse existing
    # parquet + mmsi map (used for the determinism re-run check).
    only_aggregate = os.environ.get("BALTIC_PIPELINE_ONLY_AGGREGATE") == "1"
    for month in SLICE_MONTHS:
        y = month.split("-")[0]
        pq_dir = WORK / "parquet" / y
        mmsi_csv = OUT / "mmsi_group.csv"
        if only_aggregate:
            if not pq_dir.exists() or not mmsi_csv.exists():
                raise RuntimeError("ONLY_AGGREGATE=1 but parquet/mmsi map missing — run full pipeline first")
            log(f"stage 1-3 skipped (ONLY_AGGREGATE), reusing {pq_dir}")
        else:
            manifest = stage1_mirror(month)
            pq_dir = stage2_normalize(month, manifest)
            mmsi_csv = stage3_classify(pq_dir)
        stage4_aggregate(pq_dir, mmsi_csv, month)
    write_anchor()
    total = sum(p.stat().st_size for p in SITE_DATA.rglob("*") if p.is_file())
    log(f"DONE. site data total: {total/1e6:.2f} MB (budget: <= 10 MB slice, <= 100 MB all)")


if __name__ == "__main__":
    sys.exit(main())
