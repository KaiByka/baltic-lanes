# Baltic Lanes — build orchestration (contract: AGENTS.md, specs: docs/)

.PHONY: help validate pipeline site render basemap clean

help:
	@echo "validate  - build the site and run QA gates (budgets, Lighthouse)"
	@echo "site      - build the static site into site/dist/"
	@echo "basemap   - regenerate self-hosted Natural Earth basemap assets"
	@echo "pipeline  - run full data pipeline (mirror must already be on disk)"
	@echo "render    - render share MP4s into site/press/"
	@echo "clean     - remove build outputs (never raw mirror data)"

site:
	npm --prefix site ci --no-audit --no-fund
	npm --prefix site run build

validate: site
	node site/scripts/validate.mjs

basemap:
	node site/scripts/build-basemap.mjs

pipeline:
	@echo "Not implemented yet: see docs/pipeline.md stages 1-6."
	@exit 1

render:
	@echo "Not implemented yet: see docs/pipeline.md stage 6."
	@exit 1

clean:
	rm -rf site/dist
