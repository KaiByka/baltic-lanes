# Baltic Lanes — Frontend Spec

One static page. Dark canvas. The sea is the hero.

## Layout

- Full-viewport map, dark sea (near-black blue), land as slightly lighter matte polygons (Natural Earth, self-hosted). Minimal graticule. No street labels, no POIs. Port names only, tiny, at zoom 4+.
- Bottom bar: time slider (2006 → 2026, monthly granularity), play/pause, speed. Current month displayed large ("July 2019").
- Top-left: vessel-group filter chips (Tankers, Cargo, Ferries/Cruise, Fishing, Pleasure craft, All). Chip selection lazy-loads that group's data file.
- Top-right: "Share" (copies deep link), "Video" (links to the MP4), "Embed" (copies iframe snippet), "About".

## Opening experience (the make-or-break 5 seconds)

- No blank map. On load: autoplay the full 20-year run in 90 seconds ("Twenty years in ninety seconds"), starting immediately, with a "Pause and explore" affordance. If the user touches anything, autoplay stops and hands over control.
- First paint (basemap + current month) in under 3 s on 4G mobile.

## Scenes (deep-linkable)

`#scene=shadowfleet | covid | sailboats | cruise | ferries | tour`

Each scene: sets filters + date range + camera, shows a 2–3 sentence caption card (top-left, dismissible), and pauses on its most dramatic frame. The scene system is the sharing unit: every Reddit post, tweet and press link points at a scene URL, not the bare site.

Caption requirements: factual, careful wording (no unverifiable "shadow fleet" claims — see pipeline.md), source line "Data: Danish Maritime Authority".

## Layers

- **Density:** deck.gl grid/hex aggregation, color ramp from the dark theme (deep blue → cyan → warm highlight for peak cells). Animated crossfade between months.
- **Flows:** Arc/flow layer for the era flow lines (stage 4.3), subtle, animated dashes.
- **Gate sparklines:** clicking a gate strait (Great Belt etc.) opens a small uPlot/SVG chart of the 20-year transit time series for that gate, filterable by group. This is the feature journalists screenshot.

## Charts

Small multiples of transit counts per group (tiny, SVG/uPlot), shown in the About/Methodology page for each gate. No chart library heavier than uPlot.

## Share & embed

- **Deep links:** every state (filters, month, scene, camera) serializes to the URL hash. Paste = same view.
- **Embed:** `/embed.html` — iframe-able variant, no chrome, auto-height, renders the current scene loop, footer "baltic.marespot.com" as a link (this is the attribution-viral mechanism).
- **Video:** the MP4s live at stable URLs under `/press/`, linked from the share menu and the press kit page.

## MareSpot linkage (exact, do not expand)

1. Footer, all pages: "A MareSpot experiment — live Adriatic wind, shelter & sea temperature at marespot.com" (text link).
2. In the `sailboats` scene caption only, one added sentence: "Yacht season on the Adriatic: see live wind, shelter and sea temperature at marespot.com."
3. About page: one line "Built by the maker of MareSpot." Nothing else. No banners, no popups, no interstitials.

## About / Methodology page

- What AIS is, what the archive is, how aggregation works (grid size, monthly counts), what the classifications mean, known limitations (Class B underrepresentation, DMA coverage area), data license + attribution, the QA numbers from pipeline.md.
- Press kit section: downloadable scene MP4s + 6 pre-rendered stills (one per scene) at 1920×1080, a 200-word boilerplate description, and the embed snippet. Written for a journalist to lift wholesale.

## Performance budget

| Metric | Target |
|---|---|
| First load (HTML+JS+CSS+basemap+first month) | ≤ 3 MB |
| Total lazy data (all groups, all months) | ≤ 100 MB |
| Time-to-interactive on mid-range phone | < 3 s |
| Lighthouse mobile performance | ≥ 80 |

If a group's data file exceeds its budget, the pipeline coarsens it — the frontend never receives uncompressed or raw data.

## Analytics

GoatCounter script, loaded async, `defer`. Track: pageviews, scene opens, filter clicks, video downloads. Nothing else, no cookies. A `make stats` note in the About page states what is collected (trust-building detail that fits the project's open-data ethos).
