# AGENTS.md — Baltic Lanes agent contract

You are a coding agent working on Baltic Lanes. This file is the contract. Read it before every task. When a task conflicts with this file, this file wins; ask a human only if the conflict cannot be resolved.

## Mission

Build an animated, interactive static site showing 20 years of Baltic Sea shipping (2006–2026) from the Danish Maritime Authority's open AIS archive, published on GitHub Pages at `baltic.marespot.com`. The site must be visually stunning, instantly understandable, fast on mobile, and structured to be shared (story scenes, embeds, video export).

## Non-negotiable hard rules

1. **Static output only.** The published site is static files. No backend, no server code, no databases, no auth. The pipeline runs offline and commits its aggregated output to the repo.
2. **No API keys at runtime.** No MapTiler/Google/CARTO keys in the site. Basemap is self-hosted (dark sea + Natural Earth land polygons). Third-party JS is bundled at build time, not hot-linked, except the analytics script (rule 6).
3. **Data budget.** Total data directory ≤ 100 MB. First load (HTML+JS+CSS+basemap+first month) ≤ 3 MB. Data is lazy-loaded per vessel group and per scene. If the aggregate exceeds the budget, coarsen the grid or split by group — never ship raw points.
4. **No individual vessel tracking in the UI.** The site shows aggregates (densities, counts, flows). Pleasure craft is aggregate-only: no MMSI/name lookup, no individual yacht highlighting, no "find my boat". (Privacy posture + it keeps the project safely non-navigational.)
5. **License discipline.** Before first public launch, read the DMA terms at aisdata.ais.dk and record the check in `docs/pipeline.md` §Licenses. Attribute DMA, Natural Earth, MapLibre, deck.gl in the footer. Do not scrape or redistribute raw AIS files — only aggregates and derived statistics.
6. **Privacy-friendly analytics only.** GoatCounter (or Plausible) script, no cookies, no fingerprinting, no Google Analytics. Nothing else phones home. No newsletter popups, no banners, no cookie banners (not needed since no tracking cookies).
7. **MareSpot branding, minimal.** Footer credit exactly once: "A MareSpot experiment — live Adriatic wind, shelter & sea temperature at marespot.com" as a text link. Exactly ONE contextual bridge: in the pleasure-craft scene, one sentence linking the July sailboat bloom to Adriatic conditions on MareSpot. No other cross-promotion anywhere. Do not add more links to MareSpot without human approval.
8. **Fast and mobile-first.** Target: interactive in < 3 s on a mid-range phone over 4G. Test with the repo's built-in Lighthouse run; fail the sprint if performance < 90 on desktop / < 80 on mobile.
9. **No signup, no ads, no social-share popups.** Share features are plain deep links and the pre-rendered MP4.

## Tech stack (fixed)

- **Pipeline (offline, not deployed):** Python 3.12. pandas/pyarrow (Parquet), DuckDB for the heavy aggregations, shapely for geometry, matplotlib/cartopy + ffmpeg for the share-video renders. Output: compressed JSON (zstd) + a few small Parquet files.
- **Site:** TypeScript + Vite. MapLibre GL JS for the base canvas + deck.gl for the layers (HexLayer/Heatmap for density, ArcLayer/TripsLayer for flows). No framework (React not needed); vanilla TS modules are fine.
- **Charts (small multiples, transit counts):** uPlot or hand-rolled SVG (small, fast).

## Working method

- Sprints, each ending in a verifiable success test (defined in `docs/pipeline.md` and `docs/frontend.md`).
- Commit small, conventional commits, every task leaves the repo buildable (`make site` succeeds, `make validate` passes).
- Data files are generated, never hand-edited. The generator is deterministic: same input → same output bytes.
- Keep the repo under 150 MB total (GitHub hard limit considerations for Pages).

## Definition of done for the whole project

A visitor on a phone opens `baltic.marespot.com`, sees the sea light up with 20 years of traffic within 3 seconds, hits play, understands the story, and can share a scene link or download the 90-second MP4. The about page explains data and method well enough for a journalist to cite it.
