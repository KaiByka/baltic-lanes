# Baltic Lanes — Data Pipeline Spec

Goal: turn ~3 TB of raw daily AIS CSVs from the Danish Maritime Authority into < 100 MB of aggregates the static site can render, plus pre-rendered share videos.

## Source

- **Archive:** http://aisdata.ais.dk/ (S3 bucket `aisdata.ais.dk`, eu-central-1). ZIP files of AIS messages, 2006 → present. Danish waters coverage (the DMA archive is the Baltic + Danish straits goldmine: it covers exactly the busiest chokepoints, Great Belt and Øresund).
- **Layout (verified 2026-11-18 for 2024):** daily zips `2024/aisdk-2024-07-01.zip` … `aisdk-2024-07-31.zip` exist **from 2024-03 onwards**; Jan/Feb 2024 are *monthly* zips (`aisdk-2024-01.zip`, `aisdk-2024-02.zip`). When the full 20-year mirror is scheduled, the layout must be re-verified year by year back to 2006 (2006 shows monthly zips) — never assume the 2024 layout for older years.
- **Verified CSV schema (canonical, verified 2026-11-18 against `2024/aisdk-2024-07-01.zip`, 18,511,710 rows; matches the archive's own `!_README_information_CSV_files.txt`):**
  - comma delimiter `,`; header line prefixed with `# `; **26 columns**:
    `Timestamp, Type of mobile, MMSI, Latitude, Longitude, Navigational status, ROT, SOG, COG, Heading, IMO, Callsign, Name, Ship type, Cargo type, Width, Length, Type of position fixing device, Draught, Destination, ETA, Data source type, A, B, C, D`
  - `Timestamp` format `DD/MM/YYYY HH:MM:SS` (e.g. `01/07/2024 00:00:00`), no timezone. **Assumption: treat as UTC** (parse with explicit dayfirst format). Per-month aggregation makes any residual ambiguity immaterial.
  - Lat/Lon use decimal points but the archive is **worldwide** (observed lat 36–91, lon −75–17) — the Baltic bbox filter in Stage 2 is mandatory, not optional.
  - `Type of mobile` values observed: `Class A`, `Class B`, `Base Station`, `AtoN`. Base Station/AtoN rows are not vessels and are dropped in Stage 2 (drop counts logged).
  - `Ship type` is **text names**, not AIS numeric codes: `Cargo, Fishing, Passenger, Tanker, Sailing, Pleasure, Other, Pilot, Dredging, Tug, SAR, HSC, Military, Diving, Towing, Undefined, …`
  - Rows are ragged (some have fewer fields) — parser must use null-padding.
  - MMSI lengths observed 4–9; the checksum-plausibility gate is kept loose (accept length 4–9).
  - Empty / `Unknown` / `Undefined` strings are treated as NULL.
- The raw→Parquet normalize stage keeps **all 26 columns** (fixed schema). Downstream aggregates use only the needed fields; **Name/Callsign never appear in any output** (aggregate-only rule).
- Class A = big vessels; Class B = mostly leisure. Draught + Ship/Cargo type are the interesting analytic columns.

## Licenses (blocker before public launch)

- [ ] Read the DMA terms of use for aisdata.ais.dk data. Record: permitted use, redistribution terms (we publish **aggregates only**, never raw rows), required attribution text.
- [ ] Natural Earth: public domain, no restrictions.
- [ ] Record the check date + link in this section. Do not launch before this is done.

## Stage 1 — Mirror

- Download the archive to local disk (NOT to the repo). Rate-limit politely; the archive is static files, so a resumable rsync-style mirror is fine.
- Verify each ZIP (CRC, row count sanity) and keep a manifest with SHA256s so the pipeline is reproducible.
- Disk needed: ~3 TB raw + ~1.5 TB Parquet working space.

## Stage 2 — Normalize

- CSV → Parquet, one file per day, partitioned by year. Fixed 26-column schema as verified in §Source; timestamps parsed dayfirst and treated as UTC; empty/`Unknown`/`Undefined` → NULL.
- Validate (QA gates, all logged per day):
  - **Baltic bbox filter is mandatory** (archive is worldwide): keep lat 53–66, lon 9–31; **zero out-of-bbox coordinates after filtering** (asserted).
  - Drop `Type of mobile` in (`Base Station`, `AtoN`) before classification; drop counts logged.
  - MMSI loose gate: length 4–9 accepted.
  - Drop duplicate (MMSI, timestamp) rows.
  - Row counts per day within ±20% of file-size expectation.
- Keep SOG/COG/Ship type/Cargo type/Draught/Length/Class. Do not keep Name/Callsign in downstream aggregates (rule: aggregate-only, no vessel identification features).

## Stage 3 — Classify

Group every MMSI into one of 7 groups. **Ship type is text** (verified schema, §Source); explicit mapping:

| Ship type (text) | group |
|---|---|
| `Tanker` | `tanker` |
| `Cargo` | `cargo` |
| `Passenger` | `ferry`, or `cruise` if length > 150 m (cruise-vs-ferry heuristic: passenger ships > 150 m) |
| `Fishing` | `fishing` |
| `Sailing`, `Pleasure` | `pleasure` |
| everything else (`Pilot`, `Tug`, `SAR`, `HSC`, `Military`, `Dredging`, `Diving`, `Towing`, `Other`, `Undefined`, …) | `other` |

- The MMSI's ship type is the modal (most frequent) non-Undefined value across its messages; length is its max reported length.
- MMSI → group map is a small static lookup table committed to the repo (it's derived data, ~tens of thousands of rows, fine): `pipeline/output/mmsi_group.csv`.

## Stage 4 — Aggregate (this is the site's data)

All aggregates monthly (240 months) and per group:

1. **Density grid:** web-mercator grid over the Baltic bbox, one zstd-compressed JSON file per group, lazy-loaded. Per cell × month × group the shipped payload is `[cellId, messageCount]` only (aggregate-only rule: no per-vessel fields, no Name/Callsign). Spec grid is ~1 km; **sprint 2 ships 4 km** under the AGENTS.md rule-3 coarsen clause — 1–2 km pushed first-load bytes and Lighthouse mobile TTI past the rule-8 perf gate (see `pipeline/run.py` CELL_M). Budget: ≤ 60 MB total. If over: coarsen further or drop `other`. `cellId = cellY * ncols + cellX` over the world-mercator lattice, `ncols = ceil(worldWidthM / cellMeters)` — the same `ncols` is the decode modulus in the frontend (`src/view.ts` cellToLonLat).
2. **Transit time series:** counts per month per group through named gate polygons: Great Belt, Øresund (north+south), Kadetrenden, Bornholm channel, Gulf of Finland approach. Tiny JSON, one series each. These power the small-multiple charts and are the journalist-friendly numbers.
3. **Flow lines:** top ~150 origin→destination arcs per group per era (2006–2012, 2013–2019, 2020–2026) derived from resampled tracks with anchorage/port-cluster endpoints. Static GeoJSON for an Arc/Flow layer.

## Stage 5 — Story scene datasets

Each scene = a tiny derived dataset + a deep link (`#scene=...`):

- **shadowfleet** — tanker traffic density diff around Russian Baltic oil port approaches (Primorsk, Ust-Luga, St Petersburg), 2019 baseline vs each year after. LABEL CAREFULLY: the site must say "tanker traffic near Russian Baltic ports", never claim which vessels are "shadow fleet" (we cannot verify ownership/insurance from AIS).
- **covid** — April 2020 vs April 2019 density diff, all groups.
- **sailboats** — July pleasure-craft density, Class B only, July 2019 vs July 2024.
- **cruise** — cruise ship presence growth, 2006 vs 2016 vs 2026, Baltic cruise season months.
- **ferries** — the scheduled pulse: one representative week, hourly counts, showing routes breathing on schedule.

## Stage 6 — Share video renders

- From the density grids: 90-second MP4, "Twenty years of Baltic shipping in ninety seconds", one frame per month × 30 fps interpolation, dark theme matching the site. 1080p, ≤ 15 MB, plus a 20 MB 4K variant.
- One 15-second loop MP4 per story scene (these go in the press kit).
- Renders are committed to the repo under `site/press/` (they double as the press kit assets).

## QA gates (define before coding each stage)

- Stage 2: row counts per day within ±20% of file-size expectation; zero out-of-bbox coordinates.
- Stage 4: annual Great Belt transit counts should be in the same order of magnitude as published DMA strait statistics (find one published number to anchor against and note it here).
- Stage 4: monthly unique-vessel counts never exceed plausible fleet sizes per group.
- Determinism: `make pipeline` twice → identical SHA256s.

## Success test for the pipeline as a whole

From raw archive on disk to `site/data/` under budget in one command, reproducible, with the QA report printed at the end. Any agent finishing a stage adds its QA numbers to this file.
