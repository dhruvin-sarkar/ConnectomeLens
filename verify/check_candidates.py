"""Check the candidate table is explained, hedged, and restricted to isomorphic top-ranked types."""

import re

import pandas as pd

from pipeline.candidates import CANDIDATES_PATH, HEDGE, TOP_FRACTION
from pipeline.common import RESULTS, SCORES_PATH


def main() -> None:
    text = (RESULTS / "candidates.md").read_text(encoding="utf-8")
    assert not re.search(r"discover", text, re.IGNORECASE), "Candidate report uses 'discovery' language"

    table = pd.read_parquet(CANDIDATES_PATH)
    assert len(table) > 0, "No candidates"
    assert (table["top_features"].str.strip() != "").all(), "Candidate without an explanation"

    scores = pd.read_parquet(SCORES_PATH).set_index("cell_type")
    threshold = scores["oof_probability"].quantile(1 - TOP_FRACTION)
    chosen = scores.loc[table["cell_type"]]
    assert (chosen["label"] == "isomorphic").all(), "Candidate table includes labeled sex-related types"
    assert (chosen["oof_probability"] >= threshold).all(), "Candidate below the top-percentile threshold"

    rows = [line for line in text.splitlines() if line.startswith("| ") and not line.startswith("| cell type")]
    assert len(rows) == len(table), f"{len(rows)} table rows vs {len(table)} candidates"
    assert all(HEDGE in row for row in rows), "Row missing the hedge note"
    print(f"OK: {len(table)} candidates, all explained and hedged")


if __name__ == "__main__":
    main()
