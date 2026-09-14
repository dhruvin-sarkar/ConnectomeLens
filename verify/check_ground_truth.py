"""Check the type-level dimorphism labels for completeness and agreement with the published counts."""

import pandas as pd

from pipeline.common import LABELS_PATH
from pipeline.ground_truth import LABELS

# Berg et al. (2026) Cell 189:5504, abstract: "8,069 isomorphic, 138 dimorphic, 289 male-specific,
# and 71 female-specific types".
PUBLISHED_COUNTS = {"male_specific": 289, "dimorphic": 138}


def main() -> None:
    assert LABELS_PATH.exists(), f"{LABELS_PATH} missing; run python -m pipeline.ground_truth"
    labels = pd.read_parquet(LABELS_PATH)
    assert labels["label"].notna().all(), "Null labels present"
    assert labels["cell_type"].is_unique, "Duplicate cell types"
    assert set(labels["label"]) <= set(LABELS), f"Unexpected labels: {set(labels['label']) - set(LABELS)}"

    counts = labels["label"].value_counts()
    for label, published in PUBLISHED_COUNTS.items():
        assert published, f"Published count for {label} not set"
        ratio = counts.get(label, 0) / published
        assert 0.1 <= ratio <= 10, f"{label}: {counts.get(label, 0)} types vs {published} published (ratio {ratio:.2f})"
        print(f"{label}: {counts.get(label, 0)} types (published {published}, ratio {ratio:.2f})")
    print(f"OK: {len(labels)} labeled types")


if __name__ == "__main__":
    main()
