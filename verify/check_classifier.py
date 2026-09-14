"""Check classifier performance against the prevalence baseline and publicly named dimorphic types."""

import json
import sys

import pandas as pd

from pipeline.common import NAMED_TYPES, RESULTS, SCORES_PATH

MIN_LIFT = 2.0
TOP_N = 20


def main() -> None:
    metrics = json.loads((RESULTS / "classifier_metrics.json").read_text(encoding="utf-8"))
    assert (RESULTS / "classifier_model.txt").exists(), "Model artifact missing"
    failures = []

    lift = metrics["auc_pr"] / metrics["baseline_auc_pr"]
    print(f"AUC-PR {metrics['auc_pr']:.3f} vs baseline {metrics['baseline_auc_pr']:.3f} (lift {lift:.1f}x)")
    if lift < MIN_LIFT:
        failures.append(f"AUC-PR lift {lift:.2f} below {MIN_LIFT}")
    weak_folds = [v for v in metrics["fold_auc_pr"] if v <= metrics["baseline_auc_pr"]]
    if weak_folds:
        failures.append(f"{len(weak_folds)} folds at or below baseline")

    scores = pd.read_parquet(SCORES_PATH).sort_values("oof_probability", ascending=False).reset_index(drop=True)
    top = set(scores.head(TOP_N)["cell_type"])
    for name in NAMED_TYPES:
        row = scores[scores["cell_type"] == name]
        rank = int(row.index[0]) + 1 if len(row) else None
        detail = f"rank {rank}, probability {row['oof_probability'].iloc[0]:.3f}, label {row['label'].iloc[0]}" if rank else "absent"
        print(f"{name}: {detail}")
    if not top.intersection(NAMED_TYPES):
        failures.append(f"none of {', '.join(NAMED_TYPES)} is in the top {TOP_N} by out-of-fold probability")

    if failures:
        print("FAIL: " + "; ".join(failures))
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
