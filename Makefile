# Baltic Lanes — build orchestration
# Everything below is a target for coding agents to implement (see AGENTS.md, docs/).
# This stub exists so the contract is runnable from day one.

.PHONY: help validate pipeline site render clean

help:
	@echo "validate  - run QA checks (data budgets, determinism, Lighthouse)"
	@echo "pipeline  - run full data pipeline (mirror must already be on disk)"
	@echo "site      - build the static site into site/dist/"
	@echo "render    - render share MP4s into site/press/"
	@echo "clean     - remove build outputs (never raw mirror data)"

validate:
	@echo "Not implemented yet: first pipeline sprint task is to implement this target."
	@exit 1

pipeline:
	@echo "Not implemented yet: see docs/pipeline.md stages 1-6."
	@exit 1

site:
	@echo "Not implemented yet: see docs/frontend.md"
	@exit 1

render:
	@echo "Not implemented yet: see docs/pipeline.md stage 6."
	@exit 1

clean:
	rm -rf site/dist
