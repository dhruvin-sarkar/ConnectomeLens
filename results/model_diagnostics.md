# Model diagnostics

Descriptive analyses of the out-of-fold predictions in `data/scores.parquet`. The pre-specified results are in `classifier_metrics.md` and `null_model_validation.md`; nothing here changed the model, its features or its hyperparameters. Feature subsets marked exploratory were evaluated after the null-model results were known and only describe where the signal sits.

## Ranking

| flagged | types | sex-related among them | precision | share of all sex-related types |
|---|---|---|---|---|
| top 1% | 118 | 116 | 0.98 | 0.24 |
| top 5% | 588 | 350 | 0.60 | 0.73 |
| top 10% | 1175 | 405 | 0.34 | 0.85 |

## Calibration

The model weights the positive class by the class ratio, so its probabilities rank types but overstate the chance that a type is sex-related: the mean predicted probability is 0.074 against a prevalence of 0.041. Brier score 0.0244 (predicting the prevalence for every type gives 0.0390).

| probability range | types | mean probability | observed sex-related rate |
|---|---|---|---|
| 0.000–0.001 | 1176 | 0.000 | 0.000 |
| 0.001–0.001 | 1175 | 0.001 | 0.001 |
| 0.001–0.002 | 1175 | 0.002 | 0.003 |
| 0.002–0.004 | 1175 | 0.003 | 0.002 |
| 0.004–0.007 | 1175 | 0.006 | 0.006 |
| 0.007–0.013 | 1175 | 0.010 | 0.003 |
| 0.013–0.024 | 1175 | 0.018 | 0.009 |
| 0.024–0.052 | 1175 | 0.035 | 0.009 |
| 0.052–0.175 | 1175 | 0.095 | 0.029 |
| 0.175–0.998 | 1175 | 0.569 | 0.345 |

## Feature attributions

Mean absolute SHAP value (log-odds) over all 11,751 types, each type explained by the fold model that scored it. Share of the total by feature group: neuropil 68%, topology 29%, transmitter 3%.

| feature | group | mean abs SHAP | mean SHAP, sex-related | mean SHAP, isomorphic |
|---|---|---|---|---|
| community | topology | 0.828 | +1.485 | -0.101 |
| out_frac_PLP | neuropil | 0.462 | +0.307 | -0.003 |
| out_frac_SIP | neuropil | 0.455 | +1.146 | -0.026 |
| out_frac_SLP | neuropil | 0.367 | +0.152 | +0.004 |
| in_strength | topology | 0.352 | +0.192 | +0.007 |
| out_frac_CentralBrain-unspecified | neuropil | 0.267 | +0.232 | -0.020 |
| in_degree | topology | 0.264 | +0.059 | +0.002 |
| pagerank | topology | 0.250 | -0.006 | -0.005 |
| out_frac_SCL | neuropil | 0.227 | +0.382 | -0.053 |
| out_frac_SPS | neuropil | 0.218 | +0.111 | +0.002 |
| out_frac_WED | neuropil | 0.205 | +0.063 | -0.004 |
| nt | transmitter | 0.203 | +0.061 | -0.001 |
| out_frac_LegNp(T1) | neuropil | 0.195 | +0.062 | -0.002 |
| out_frac_AVLP | neuropil | 0.192 | +0.403 | -0.022 |
| out_frac_VNC-unspecified | neuropil | 0.188 | +0.043 | -0.033 |

## Feature subsets

| features | count | AUC-PR | ROC AUC | precision in top 100 | status |
|---|---|---|---|---|---|
| full | 89 | 0.759 | 0.952 | 0.99 | pre-specified |
| topology only | 9 | 0.489 | 0.894 | 0.78 | pre-specified |
| static only | 80 | 0.726 | 0.946 | 0.98 | pre-specified |
| neuropil only | 79 | 0.722 | 0.945 | 0.98 | exploratory |
| transmitter only | 1 | 0.049 | 0.559 | 0.05 | exploratory |
| community only | 1 | 0.164 | 0.818 | 0.22 | exploratory |
| topology without community | 8 | 0.123 | 0.783 | 0.15 | exploratory |
| topology and transmitter | 10 | 0.503 | 0.902 | 0.83 | exploratory |
| full without community | 88 | 0.740 | 0.945 | 1.00 | exploratory |

## Leiden communities

| community | types | male-specific | dimorphic | mean probability | main output neuropils |
|---|---|---|---|---|---|
| 0 | 2748 | 13 | 37 | 0.050 | LegNp(T3), LegNp(T2), LegNp(T1) |
| 1 | 2487 | 21 | 21 | 0.043 | WTct(UTct-T2), SPS, WED |
| 2 | 1626 | 256 | 75 | 0.293 | SMP, SIP, CRE |
| 3 | 1412 | 2 | 8 | 0.018 | SLP, LH, AL |
| 4 | 1193 | 4 | 3 | 0.019 | AVLP, PVLP, ICL |
| 5 | 719 | 4 | 7 | 0.044 | GNG, PRW, SMP |
| 6 | 526 | 3 | 2 | 0.031 | ME, LO, PLP |
| 7 | 373 | 7 | 11 | 0.106 | ANm, LegNp(T3), VNC-unspecified |
| 8 | 333 | 0 | 0 | 0.003 | FB, EB, SMP |
| 9 | 129 | 1 | 0 | 0.020 | ME, LO, PVLP |
| 10 | 126 | 0 | 0 | 0.005 | LOP, PLP, LO |
| 11 | 78 | 1 | 2 | 0.082 | LAL, AOTU, SPS |
| pooled | 1 | 0 | 0 | 0.001 | CentralBrain-unspecified, ADMN, AB |

## Superclasses

| superclass | types | male-specific | dimorphic | mean probability | AUC-PR (baseline) |
|---|---|---|---|---|---|
| cb_intrinsic | 6605 | 256 | 93 | 0.085 | 0.860 (0.053) |
| vnc_intrinsic | 2777 | 23 | 4 | 0.030 | 0.326 (0.010) |
| ascending_neuron | 563 | 26 | 20 | 0.153 | 0.648 (0.082) |
| descending_neuron | 480 | 3 | 43 | 0.214 | 0.319 (0.096) |
| visual_projection | 346 | 1 | 0 | 0.014 | too few types |
| ol_intrinsic | 271 | 3 | 1 | 0.041 | too few types |
| vnc_sensory | 169 | 0 | 0 | 0.009 | too few types |
| cb_sensory | 158 | 0 | 0 | 0.010 | too few types |
| vnc_motor | 142 | 0 | 1 | 0.030 | too few types |
| visual_centrifugal | 108 | 0 | 1 | 0.033 | too few types |
| cb_motor | 43 | 0 | 1 | 0.040 | too few types |
| vnc_efferent | 27 | 0 | 0 | 0.041 | too few types |
| sensory_ascending | 26 | 0 | 0 | 0.079 | too few types |
| ol_sensory | 11 | 0 | 0 | 0.007 | too few types |
| cb_endocrine | 10 | 0 | 0 | 0.004 | too few types |
| efferent_ascending | 5 | 0 | 0 | 0.080 | too few types |
| sensory_descending | 4 | 0 | 2 | 0.195 | too few types |
| vnc_endocrine | 4 | 0 | 0 | 0.005 | too few types |
| cb_efferent | 1 | 0 | 0 | 0.031 | too few types |
| efferent_descending | 1 | 0 | 0 | 0.006 | too few types |

## Topology by label

Medians per label. The last columns give the probability that a random sex-related type has the larger value than a random isomorphic type (0.5 means no difference) and the two-sided Mann-Whitney p-value.

| feature | male-specific | dimorphic | isomorphic | P(sex-related higher) | p |
|---|---|---|---|---|---|
| in_degree | 22 | 22 | 21 | 0.55 | 9.1e-05 |
| out_degree | 17 | 22 | 14 | 0.58 | 2.1e-09 |
| in_strength | 3183 | 3510 | 2353 | 0.60 | 4.8e-14 |
| out_strength | 2745 | 3432 | 1768 | 0.60 | 4.8e-14 |
| pagerank | 7.5e-05 | 9.2e-05 | 6e-05 | 0.62 | 2.4e-19 |
| betweenness | 2.623e+04 | 4.74e+04 | 1.864e+04 | 0.62 | 5.3e-19 |
| hops_from_sensory | 2 | 2 | 2 | 0.60 | 6.7e-15 |
| hops_to_motor | 1 | 1 | 2 | 0.36 | 2.7e-27 |

## Neuropil map against the annotations

Across the 109 neuropils with at least 10,000 synapses, the synapse-weighted mean probability correlates with the share of synapses made by annotated sex-related types (Spearman rho = 0.96, p = 1.1e-60). The two maps are not independent: the probabilities were trained on the same annotations, out of fold.

## Transmitters

| predicted transmitter | male-specific | dimorphic | isomorphic |
|---|---|---|---|
| acetylcholine | 219 | 110 | 5641 |
| gaba | 32 | 30 | 2705 |
| glutamate | 48 | 18 | 2309 |
| unclear | 11 | 4 | 433 |
| serotonin | 1 | 3 | 84 |
| dopamine | 1 | 0 | 54 |
| octopamine | 0 | 1 | 30 |
| histamine | 0 | 0 | 17 |

## Named types

| cell type | rank | probability | label |
|---|---|---|---|
| AOTU008 | 531 | 0.569 | dimorphic |
| AOTU012 | 591 | 0.502 | dimorphic |
| DNg13 | 572 | 0.520 | dimorphic |
| LoVP92 | 574 | 0.518 | male_specific |
