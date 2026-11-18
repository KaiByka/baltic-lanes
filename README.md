# Baltic Lanes — Twenty Years of Baltic Shipping

An animated, interactive map of two decades of Baltic Sea shipping, built entirely from the Danish Maritime Authority's open AIS archive (aisdata.ais.dk, daily files back to 2006, ~3 TB) and published as a **static site on GitHub Pages**.

## Why this project exists

1. **A showpiece** — the most visually striking thing we can build from open big data.
2. **A link magnet** — every backlink it earns lands on `baltic.marespot.com`, building `marespot.com`'s domain authority.
3. **A reusable pipeline** — the same code, pointed at Adriatic data later, becomes "Adriatic Alive", the audience funnel into MareSpot.

It is NOT a product. No accounts, no ads, no backend, no tracking beyond a privacy-friendly counter.

## Live at

`https://baltic.marespot.com` (GitHub Pages + custom domain).

### Custom domain setup (do this at deploy time, not at build time)

1. GitHub repo → Settings → Pages → Custom domain: `baltic.marespot.com`.
2. Add a `CNAME` file to the published branch containing exactly: `baltic.marespot.com`.
3. DNS at the marespot.com host: `CNAME baltic → <username>.github.io`.
4. Enable "Enforce HTTPS" once the certificate is issued.

Until DNS is ready, the site must still work at `https://<username>.github.io/<repo>/` (use relative paths everywhere).

## Repo layout

```
baltic-lanes/
├── README.md            ← this file
├── AGENTS.md            ← the contract every coding agent must follow
├── CNAME                ← created at deploy time (baltic.marespot.com)
├── pipeline/            ← data pipeline (Python) — NOT deployed, runs offline
│   ├── src/
│   └── Makefile
├── site/                ← the static site that gets published
│   ├── index.html
│   ├── app/             ← JS/CSS (bundled, no runtime CDN dependency if possible)
│   └── data/            ← generated aggregated data (committed to the repo)
└── docs/
    ├── pipeline.md       ← data pipeline spec
    ├── frontend.md       ← UI / scenes / performance spec
    └── launch-playbook.md← virality + domain-authority plan
```

## Working method

Agents do all the coding. Work sprint by sprint (see `docs/pipeline.md` and `docs/frontend.md` for the stage breakdown). The repo publishes with `git push` — no build servers, no CI required (a GitHub Action that rebuilds the bundle is allowed but optional).

## Attribution (required in the site footer)

- Data: Danish Maritime Authority (aisdata.ais.dk)
- Coastline/land: Natural Earth (public domain)
- MapLibre GL JS, deck.gl (BSD/Apache)
- "A MareSpot experiment — live Adriatic wind, shelter & sea temperature at [marespot.com](https://marespot.com)"
