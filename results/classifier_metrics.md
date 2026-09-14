# Classifier performance

LightGBM, 5-fold stratified cross-validation over 11751 cell types (478 sex-related, 11273 isomorphic). All scores below are out-of-fold.

| metric | value | baseline |
|---|---|---|
| AUC-PR | 0.759 | 0.041 |
| ROC AUC | 0.952 | 0.500 |
| Precision@100 | 0.99 | 0.041 |

Per-fold AUC-PR: 0.743, 0.753, 0.772, 0.787, 0.750

## By class

Each sex-related class scored against isomorphic types only, using the same out-of-fold probabilities.

| class | types | AUC-PR | baseline |
|---|---|---|---|
| dimorphic | 166 | 0.376 | 0.015 |
| male_specific | 312 | 0.832 | 0.027 |

## Feature groups

Topology features are recomputed from the graph (degree, strength, PageRank, betweenness, community, hop distances). Static features are type attributes: predicted neurotransmitter and the share of output synapses in each neuropil.

| features | count | AUC-PR | ROC AUC | Precision@100 |
|---|---|---|---|---|
| full | 89 | 0.759 | 0.952 | 0.99 |
| topology only | 9 | 0.489 | 0.894 | 0.78 |
| static only | 80 | 0.726 | 0.946 | 0.98 |

## Hemilineage-grouped cross-validation

Related types often share a developmental hemilineage and similar wiring. Keeping each hemilineage within a single fold (1124 groups; types without a hemilineage annotation are their own group) gives AUC-PR 0.701 (ROC AUC 0.932), against 0.759 with type-level folds.

## Top 20 types by out-of-fold probability

| rank | cell type | probability | Janelia label |
|---|---|---|---|
| 1 | PVLP204m | 0.998 | male_specific |
| 2 | PVLP217m | 0.998 | male_specific |
| 3 | AVLP711m | 0.998 | male_specific |
| 4 | SIP108m | 0.998 | male_specific |
| 5 | pC1_13b | 0.998 | male_specific |
| 6 | AVLP299_c | 0.998 | dimorphic |
| 7 | AVLP567 | 0.998 | dimorphic |
| 8 | mAL_m2b | 0.998 | male_specific |
| 9 | pC1_13c | 0.998 | male_specific |
| 10 | SIP119m | 0.998 | male_specific |
| 11 | SIP109m | 0.997 | male_specific |
| 12 | pC1_10a | 0.997 | male_specific |
| 13 | AVLP735m | 0.997 | male_specific |
| 14 | PVLP211m_a | 0.997 | male_specific |
| 15 | SIP115m | 0.997 | male_specific |
| 16 | SIP124m | 0.997 | male_specific |
| 17 | SIP121m | 0.997 | male_specific |
| 18 | mAL_m5a | 0.997 | male_specific |
| 19 | ICL008m | 0.997 | male_specific |
| 20 | CL123_b | 0.997 | dimorphic |
