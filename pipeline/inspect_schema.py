"""Record the neuPrint neuron schema for the male CNS dataset with live example values."""

import pandas as pd
from neuprint import NeuronCriteria as NC, NotNull, fetch_neurons

from pipeline.common import DATASET, RESULTS, get_client

# Properties the pipeline depends on, keyed by the role they play downstream.
REQUIRED_FIELDS = {
    "cell type": "type",
    "ROI / neuropil breakdown": "roiInfo",
    "predicted neurotransmitter (type level)": "celltypePredictedNt",
    "superclass (sensory / descending / motor)": "superclass",
    "sexual dimorphism annotation": "dimorphism",
    "fru / dsx expression annotation": "fruDsx",
}


def main() -> None:
    client = get_client()
    counts = client.fetch_custom(
        "MATCH (n:Neuron) UNWIND keys(n) AS k WITH k WHERE NOT k CONTAINS '(' "
        "RETURN k AS property, count(*) AS non_null ORDER BY non_null DESC"
    )
    roi_names = set(client.fetch_datasets()[DATASET]["ROIs"])
    counts = counts[~counts["property"].isin(roi_names)]

    sample, _ = fetch_neurons(NC(type=NotNull, dimorphism=NotNull, fruDsx=NotNull))
    sample = sample.head(200)

    lines = [f"# neuPrint schema: {DATASET}", "", "| property | non-null neurons | example |", "|---|---|---|"]
    for prop, n in counts.itertuples(index=False):
        values = sample[prop].dropna() if prop in sample else pd.Series(dtype=object)
        example = str(values.iloc[0])[:80].replace("|", "/") if len(values) else ""
        lines.append(f"| `{prop}` | {n} | {example} |")

    lines += ["", "## Fields used downstream", ""]
    for role, prop in REQUIRED_FIELDS.items():
        values = sample[prop].dropna() if prop in sample else pd.Series(dtype=object)
        if values.empty:
            raise RuntimeError(f"Required field {prop!r} ({role}) has no non-null values in the sample")
        lines.append(f"- {role}: `{prop}` (example: `{str(values.iloc[0])[:80]}`)")

    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / "schema_notes.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out} ({len(counts)} properties)")


if __name__ == "__main__":
    main()
