PYTHON ?= python
CHECKS := schema ground_truth type_graph features classifier pathfinder null_model candidates ablation diagnostics export

.PHONY: reproduce data model validate export test checks paper web

reproduce: data model validate export test checks

data:
	$(PYTHON) -m pipeline.inspect_schema
	$(PYTHON) -m pipeline.ground_truth
	$(PYTHON) -m pipeline.build_type_graph
	$(PYTHON) -m pipeline.compute_features

model:
	$(PYTHON) -m pipeline.train_classifier
	$(PYTHON) -m pipeline.pathfinder --source LPLC2 --target TTMn

validate:
	$(PYTHON) -m pipeline.null_model --n-trials 500
	$(PYTHON) -m pipeline.candidates
	$(PYTHON) -m pipeline.ablation
	$(PYTHON) -m pipeline.model_diagnostics
	$(PYTHON) -m pipeline.render_hero

export:
	$(PYTHON) -m export.build_static_json

test:
	$(PYTHON) -m pytest -q

# Runs every check and fails if any of them failed.
checks:
	@status=0; for c in $(CHECKS); do echo "== $$c"; $(PYTHON) -m verify.check_$$c || status=1; done; exit $$status

paper:
	cd paper && pandoc report.md -o report.pdf --pdf-engine=typst

web:
	cd web && npm ci && npm run build
