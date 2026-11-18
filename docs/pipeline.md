# Baltic Lanes — Data Pipeline Spec

Goal: turn ~3 TB of raw daily AIS CSVs from the Danish Maritime Authority into < 100 MB of aggregates the static site can render, plus pre-rendered share videos.

## Source

- **Archive:** http://aisdata.ais.dk/ — daily ZIP files of AIS messages, 2006 → present. Danish waters coverage (the DMA archive is the Baltic + Danish straits goldmine: it covers exactly the busiest chokepoints, Great Belt and Øresund).
- **Row fields (verify at download time):** Timestamp, Type of mobile (Class A/B), MMSI, Latitude, Longitude, Navigational status, ROT, SOG, COG, Heading, IMO, Callsign, Name, Ship type, Cargo type, Width, Length, Type of position fixing device, Draught.
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

- CSV → Parquet, one file per day, partitioned by year.
- Validate: lat/lon inside Baltic bbox (roughly lon 9–31, lat 53–66), timestamps parsed, MMSI checksum-plausible, drop duplicate (MMSI, timestamp) rows.
- Keep SOG/COG/Ship type/Cargo type/Draught/Length/Class. Do not keep Name/Callsign in downstream aggregates (rule: aggregate-only, no vessel identification features).

## Stage 3 — Classify

Group every MMSI into one of 6 groups (from Ship type/Cargo type + length heuristics):

`tanker`, `cargo`, `passenger/ferry`, `cruise`, `fishing`, `pleasure`, `other`

- Cruise vs ferry: passenger ships > 150 m on non-ferry routes (schedule heuristics optional; keep it simple and documented).
- MMSI → group map is a small static lookup table committed to the repo (it's derived data, ~tens of thousands of rows, fine).

## Stage 4 — Aggregate (this is the site's data)

All aggregates monthly (240 months) and per group:

1. **Density grid:** ~1 km web-mercator grid over the Baltic bbox. Per cell × month × group: message count, unique vessel count, mean SOG. Output as zstd-compressed JSON, one file per group, lazy-loaded. Budget: ≤ 60 MB total. If over: coarsen grid to 2 km or drop `other`.
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
