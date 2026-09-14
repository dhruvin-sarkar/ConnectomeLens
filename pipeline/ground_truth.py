"""Derive type-level sexual dimorphism labels from Janelia's neuron annotations."""

import pandas as pd

from pipeline.common import DATA, LABELS_PATH, get_client

# neuPrint `dimorphism` values in priority order; a type carrying several annotations takes the
# first one present. Lower-confidence "potentially" annotations count toward their class, as in
# Berg et al. (2026), whose analyses use all dimorphism labels regardless of confidence.
ANNOTATION_TO_LABEL = {
    "male-specific": "male_specific",
    "potentially male-specific": "male_specific",
    "sexually dimorphic": "dimorphic",
    "potentially sexually dimorphic": "dimorphic",
}
LABELS = ("isomorphic", "dimorphic", "male_specific", "female_specific")
SEX_RELATED = frozenset({"dimorphic", "male_specific"})


def resolve_type_labels(annotation_counts: pd.DataFrame) -> pd.DataFrame:
    """Collapse neuron annotation counts into one label per cell type.

    Args:
        annotation_counts: columns ``cell_type``, ``dimorphism`` (null when unannotated), ``n``.

    Returns:
        One row per type with ``label``, ``n_neurons``, ``n_annotated`` and ``annotations``.
    """
    unknown = set(annotation_counts["dimorphism"].dropna()) - set(ANNOTATION_TO_LABEL)
    if unknown:
        raise ValueError(f"Unrecognized dimorphism annotations: {sorted(unknown)}")

    rows = []
    for cell_type, group in annotation_counts.groupby("cell_type", sort=True):
        present = set(group["dimorphism"].dropna())
        label = next((ANNOTATION_TO_LABEL[a] for a in ANNOTATION_TO_LABEL if a in present), "isomorphic")
        rows.append(
            {
                "cell_type": cell_type,
                "label": label,
                "n_neurons": int(group["n"].sum()),
                "n_annotated": int(group.loc[group["dimorphism"].notna(), "n"].sum()),
                "annotations": "; ".join(sorted(present)),
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    client = get_client()
    counts = client.fetch_custom(
        "MATCH (n:Neuron) WHERE n.type IS NOT NULL "
        "RETURN n.type AS cell_type, n.dimorphism AS dimorphism, count(*) AS n"
    )
    labels = resolve_type_labels(counts)
    DATA.mkdir(exist_ok=True)
    labels.to_parquet(LABELS_PATH, index=False)

    print(f"Wrote {LABELS_PATH}: {len(labels)} types")
    print(labels["label"].value_counts().to_string())
    mixed = labels[labels["annotations"].str.contains(";")]
    partial = labels[(labels["n_annotated"] > 0) & (labels["n_annotated"] < labels["n_neurons"])]
    print(f"Types with more than one annotation: {len(mixed)}; partially annotated types: {len(partial)}")


if __name__ == "__main__":
    main()
