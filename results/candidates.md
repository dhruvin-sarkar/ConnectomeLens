# Candidate cell types

Types that Janelia annotates as isomorphic but whose out-of-fold probability is in the top 1% of all 11,751 types (probability >= 0.993). Out-of-fold means each type was scored by a model that never saw its label. Feature explanations are SHAP values from that same fold model; listed features are the three pushing the score most strongly towards sex-related.

These are candidates for further investigation, not new findings of dimorphism. Most of the signal separating sex-related from isomorphic types comes from neuropil location and membership of a wiring community dominated by male-specific types, so a high score says a type sits in the same circuits as known sex-related types. Confirming dimorphism requires comparison with the female connectome or with light-level anatomy.

## fru/dsx cross-reference

fru/dsx expression was not a model input. 2 of 2 candidates carry a fru or dsx annotation, against 587 of 11,271 other isomorphic types (one-sided Fisher exact test: odds ratio unbounded because every candidate is annotated, p = 0.0027).

## Table

| cell type | neurons | probability | strongest contributing features | fru/dsx | sex-related partners | note |
|---|---|---|---|---|---|---|
| CL062_b3 | 2 | 0.995 | member of wiring community 2; 3% of output synapses in SIP; 1% of output synapses in EPA | fru_low (2/2 neurons) | 63% | Candidate for further investigation: wiring resembles sex-related types; correlational, not evidence of dimorphism. |
| CL062_b2 | 2 | 0.993 | member of wiring community 2; 3% of output synapses in SIP; 1% of output synapses in EPA | fru_low (2/2 neurons) | 69% | Candidate for further investigation: wiring resembles sex-related types; correlational, not evidence of dimorphism. |
