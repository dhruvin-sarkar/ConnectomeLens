---
title: "Wired Different: a wiring-only classifier for sexually dimorphic cell types in the male *Drosophila* connectome"
author: Dhruvin Sarkar
date: 14 September 2026
papersize: a4
fontsize: 10pt
margin:
  x: 2cm
  y: 1.9cm
---

# Abstract

HHMI Janelia and Google Research recently published the first complete wiring diagram of an adult male fruit fly's central nervous system, about 166,700 neurons and 125 million synapses. They found that 498 of the 8,567 cell types matched between the male and female brains (about 6%) are dimorphic or sex-specific, concentrated in higher brain centers. We asked whether that difference leaves a detectable signature in the male wiring itself, using no features taken from the female brain. A gradient-boosted classifier trained only on male-connectome features predicts which of 11,751 cell types Janelia annotates as dimorphic or male-specific, with a cross-validated AUC-PR of 0.759, against 0.041 expected by chance. That is significantly above a degree-preserving randomized null model: none of 500 randomized graphs reached the real score (p = 0.002). Graph topology features alone reach 0.489, against 0.070 on randomized graphs (p = 0.002). We use the classifier to flag isomorphic-labeled cell types whose wiring resembles sex-related types as candidates for further investigation. Separately, as a check on the graph construction, we reconstruct the well-established Giant Fiber escape circuit from graph structure alone.

# Introduction

A connectome records which neurons contact which, and how strongly. For *Drosophila melanogaster* there are now whole-brain connectomes of both sexes: the female FlyWire brain (Dorkenwald et al. 2024; Schlegel et al. 2024) and the male central nervous system, brain and ventral nerve cord together, released by HHMI Janelia FlyEM and Google Research (Berg et al. 2026; Januszewski and Jain 2026). Berg et al. matched cell types across the two datasets and reported 8,069 isomorphic, 138 dimorphic, 289 male-specific and 71 female-specific types. Sex-specific and dimorphic neurons are concentrated in higher brain centers, while the sensory and motor periphery is largely isomorphic.

Those labels come from comparing two connectomes. This project asks a narrower question: does a cell type's position in the male wiring diagram, taken on its own, carry information about whether the type is sex-related? If it does, wiring could help prioritize cell types for comparative study when only one sex has been reconstructed. If it does not, the dimorphism annotation is invisible without a second connectome.

A classifier that scores well does not settle the question. Cell types differ enormously in size and connectivity, and a model can separate classes using only the degree sequence, meaning how many partners each type has regardless of who they are. The central test here is therefore a comparison against randomized graphs that keep every type's in-degree and out-degree but scramble who connects to whom, and the results lead with it.

Two further analyses reuse the same graph. A weighted shortest-path search recovers the Giant Fiber escape pathway, a textbook circuit (von Reyn et al. 2014; Ache et al. 2019). This checks the graph construction independently of the dimorphism labels. A node-removal analysis then asks which alternative routes the graph contains once the Giant Fiber is deleted. All results are correlational and structural.

# Data and Methods

## Data source

All data come from neuPrint (Plaza et al. 2022), dataset `male-cns:v1.0`, queried with `neuprint-python`. The database holds 176,422 neuron records, of which 164,506 carry a cell type, across 11,751 types. Neuropil meshes and neuron skeletons for figures and the demo site were read from Janelia's public data bucket for the same release. No FlyWire data, no cross-dataset matching field such as `flywireType`, and no female-derived quantity was used as a model input.

## Labels

Each neuron's `dimorphism` property holds Janelia's annotation. Annotations were aggregated to one label per type, in priority order: male-specific or potentially male-specific, then sexually dimorphic or potentially sexually dimorphic, otherwise isomorphic. Following Berg et al., annotations are used regardless of confidence.

This gives 312 male-specific, 166 dimorphic and 11,273 isomorphic types, which is 1.08 and 1.20 times the published counts of 289 and 138. The type set here is larger, most likely because it covers every typed neuron rather than only cross-matched types. Female-specific types cannot occur in a male dataset, so the task is binary: sex-related (dimorphic or male-specific, 478 types, 4.1%) versus isomorphic.

The `fruDsx` property, which records *fruitless* and *doublesex* expression, was excluded from the features. These transcription factors belong to the sex-determination pathway that defines many dimorphic neurons, and using them would leak the label. They are used only to cross-check candidates.

## Cell-type graph

Neuron-to-neuron synapse counts between typed neurons were fetched with `fetch_adjacencies` and summed into directed type-to-type edges: 3.83 million type pairs carrying 122.3 million synapses. An edge was kept if it supplies at least 1% of the target type's input synapses, and self-loops were removed. This threshold was chosen from graph statistics before any model was trained, because the unthresholded graph is too dense for meaningful hop distances. The final graph has 11,751 vertices and 243,439 edges carrying 81.3 million synapses.

## Features

Nine topology features are computed from the graph:

- in-degree and out-degree
- in-strength and out-strength (synapses on kept edges)
- PageRank and betweenness centrality
- Leiden community membership (Traag et al. 2019), using the modularity objective on the undirected weighted graph; communities with fewer than 25 types are pooled, leaving 12 communities and one pool
- hop distance from the nearest sensory type
- hop distance to the nearest descending or motor type

The 533 types that cannot reach a motor type receive a sentinel one greater than the largest observed distance.

Eighty static features describe each type without reference to topology: the predicted neurotransmitter, and the share of the type's output synapses in each of 79 bilateral neuropils. That makes 89 features in total.

## Classifier and evaluation

The classifier is LightGBM (Ke et al. 2017) with hyperparameters fixed before evaluation and never tuned:

- 400 trees, learning rate 0.03, 15 leaves, at least 20 samples per leaf
- row and column subsampling of 0.8, L2 penalty 1
- positive-class weight equal to the class ratio

Performance is measured by five-fold stratified cross-validation (seed 20260914). Every probability reported is out-of-fold: the model that scored a type never saw its label. The primary metric is the area under the precision-recall curve (AUC-PR), whose chance level equals the positive rate of 0.041; accuracy is uninformative at this class balance.

Two sensitivity analyses were specified in advance. The first is per-class AUC-PR. The second is cross-validation that keeps each developmental hemilineage inside a single fold, since sibling types from one hemilineage share wiring.

## Null model

The analysis plan was written down before any randomized graph was scored. Each of 500 null graphs is the real graph after 10 × |E| degree-preserving edge swap attempts (`igraph.Graph.rewire` restricted to simple graphs, which rejects swaps that would create multiple edges or self-loops; Maslov and Sneppen 2002). Every type keeps its exact in-degree and out-degree. Each type's outgoing synapse counts are shuffled across its new outgoing edges, so out-strength is also preserved. All nine topology features are recomputed on each null graph, and the identical model is retrained with identical folds on the real labels. Static features stay fixed because they do not depend on topology.

Two pre-specified tests share the null graphs:

1. **Full model.** Does real connectivity add signal beyond the degree sequence, neuropil distribution and transmitter?
2. **Topology-only model.** Does graph structure alone carry signal beyond the degree sequence?

Empirical one-sided p-values are (1 + number of null scores ≥ real) / (1 + N) (Phipson and Smyth 2010). With two tests, each is assessed at a Bonferroni-corrected α = 0.025.

## Pathfinder, candidates and node removal

**Pathfinder.** Each edge from type *u* to type *v* costs −log(synapses from *u* to *v* ÷ total output synapses of *u*). A path's cost is therefore the negative log of the product of successive output shares, and Dijkstra's algorithm returns the route with the largest product of output shares. The validation pair was fixed before the search was run: the looming-sensitive visual projection LPLC2 and the tergotrochanteral jump motor neuron TTMn. The pass criterion was that the Giant Fiber type DNp01 lies on the route.

**Candidates.** A candidate is a type labeled isomorphic whose out-of-fold probability is in the top 1% of all types. This rule was fixed before candidate counts were inspected. Each candidate is explained by its three largest positive SHAP contributions (Lundberg and Lee 2017) in the fold model that scored it, and cross-checked against *fru*/*dsx* annotations with a one-sided Fisher exact test.

**Node removal.** The intermediate type with the highest classifier probability on the LPLC2 → TTMn route is deleted from the graph, and routes are recomputed for LPLC2 → TTMn, LC4 → TTMn and LPLC2 → DLMn c-f.

## Descriptive diagnostics

After the pre-specified analyses, the out-of-fold predictions were described further: calibration in ten equal-count probability bins with the Brier score; SHAP values for every type from the fold model that scored it; AUC-PR within each superclass that has at least ten sex-related and ten isomorphic types; additional feature subsets; and a Spearman correlation across neuropils with at least 10,000 synapses. The additional feature subsets were evaluated after the null-model results were known and are marked exploratory. None of these analyses changed the model, its features or its hyperparameters.

## Software

| package | version |
|---|---|
| Python | 3.12.12 |
| neuprint-python | 0.6.3 |
| python-igraph | 1.0.0 |
| LightGBM | 4.7.0 |
| scikit-learn | 1.9.1 |
| SHAP | 0.52.0 |
| navis | 1.12.0 |
| NumPy / pandas / SciPy | 2.5.3 / 3.0.5 / 1.18.1 |

`make reproduce` reruns the data pipeline, the validations, the site export, the unit tests and every check script.

# Results

## The classifier beats degree-preserving randomized wiring

Out-of-fold AUC-PR is 0.759 against a chance level of 0.041, with fold values from 0.743 to 0.787. ROC AUC is 0.952, and 99 of the 100 highest-scoring types are sex-related.

On the 500 degree-preserving randomized graphs, the same model scored 0.712 ± 0.005 (range 0.696–0.725). No randomized graph reached the real value (z = 9.6, p = 0.002, the smallest p attainable with 500 graphs). The topology-only model scored 0.489 on the real graph and 0.070 ± 0.004 on randomized graphs (range 0.060–0.082; z = 111, p = 0.002). Both tests are significant at α = 0.025.

![Out-of-fold AUC-PR on the real type graph (vertical line) and on 500 degree-preserving randomized graphs (histograms), for all features (left) and topology features only (right).](../results/null_distribution.png){width=95%}

The two tests measure different things. Most of the full model's performance does not depend on topology: neuropil output shares and transmitter alone reach 0.726, and the randomized graphs, which keep those static features, still score 0.712. Real wiring adds a small but highly consistent increment on top. The topology-only test shows that the arrangement of connections by itself carries substantial information that the degree sequence does not.

| features | count | AUC-PR | ROC AUC | precision at 100 |
|---|---|---|---|---|
| all | 89 | 0.759 | 0.952 | 0.99 |
| topology only | 9 | 0.489 | 0.894 | 0.78 |
| static only | 80 | 0.726 | 0.946 | 0.98 |

Performance differs by class. Male-specific types reach AUC-PR 0.832 (chance 0.027), while dimorphic types reach 0.376 (chance 0.015). Keeping hemilineages within single folds (1,124 groups) lowers AUC-PR to 0.701 (ROC AUC 0.932). Part of the type-level score therefore reflects sibling types sharing a lineage, but most of it survives.

One pre-specified sanity check failed, and it is reported unchanged. The Google Research announcement shows AOTU008 as a neuron that differs between the sexes. The check required that AOTU008, AOTU012, DNg13 or LoVP92 appear among the 20 highest-scoring types. None does: they rank 531, 591, 572 and 574, with probabilities between 0.50 and 0.57. The top of the ranking is instead dominated by male-specific pC1, SIP and mAL types. The model recovers the bulk of sex-related types but does not single out these showcased examples.

## Where the signal sits

The ranking is concentrated at the top. The 118 types in the top 1% include 116 sex-related types, 24% of all 478; the top 10% (1,175 types) holds 85% of them.

Neuropil output shares account for 68% of the total mean absolute SHAP attribution, topology features for 29% and the transmitter for 3%. The largest single attribution is Leiden community membership (mean absolute SHAP 0.83 log-odds). Community 2, whose main output neuropils are SMP, SIP and CRE, holds 256 of the 312 male-specific and 75 of the 166 dimorphic types. The exploratory feature subsets are consistent with this: neuropil shares alone come close to the full model, while topology without community membership carries little signal.

| features | count | AUC-PR | ROC AUC | precision at 100 |
|---|---|---|---|---|
| neuropil only | 79 | 0.722 | 0.945 | 0.98 |
| transmitter only | 1 | 0.049 | 0.559 | 0.05 |
| community only | 1 | 0.164 | 0.818 | 0.22 |
| topology without community | 8 | 0.123 | 0.783 | 0.15 |
| topology and transmitter | 10 | 0.503 | 0.902 | 0.83 |
| all features except community | 88 | 0.740 | 0.945 | 1.00 |

Performance also differs between superclasses. Where both classes have at least ten types, AUC-PR is 0.860 for central brain intrinsic types (chance 0.053), 0.648 for ascending neurons (0.082), 0.326 for ventral nerve cord intrinsic types (0.010) and 0.319 for descending neurons (0.096).

Sex-related types sit closer to descending and motor types than isomorphic types do (median 1 hop against 2; Mann–Whitney p = 2.7 × 10⁻²⁷), and have somewhat higher PageRank and betweenness: a random sex-related type exceeds a random isomorphic type on either measure with probability 0.62. Across the 109 neuropils with at least 10,000 synapses, the synapse-weighted mean probability correlates with the share of synapses made by annotated sex-related types (Spearman ρ = 0.96, p = 1.1 × 10⁻⁶⁰). This agreement is expected rather than independent, because the probabilities were learned from the same annotations.

Because the positive class is up-weighted in training, the probabilities rank types but overstate frequencies. The mean predicted probability is 0.074 against a positive rate of 0.041, and in the tenth of types with the highest probabilities (mean 0.569) the observed sex-related rate is 0.345. The Brier score is 0.0244, against 0.0390 for a constant prediction at the positive rate.

## The Giant Fiber pathway is recovered from the graph

The route from LPLC2 to TTMn with the largest product of output shares is LPLC2 → DNp01 → TTMn. It carries 4,862 synapses into the Giant Fiber (2.7% of LPLC2's output) and 90 synapses onto TTMn (3.6% of DNp01's output). The routes from the second looming detector LC4 to TTMn, and from LPLC2 to the indirect flight motor neurons DLMn c-f, also pass through DNp01. The pathway emerges from chemical synapse counts alone, even though part of the Giant Fiber's output to TTMn is carried by electrical synapses that these counts do not include.

## Candidates

The top-1% threshold is a probability of 0.993. Two isomorphic-labeled types reach it: CL062_b3 (0.995) and CL062_b2 (0.993), each with two neurons.

For both, the largest contributions come from membership of wiring community 2 and from output shares in the superior intermediate protocerebrum and the epaulette. Community 2 contains 331 of the 478 sex-related types. Of the two candidates' strong partners, 63% and 69% are sex-related types.

*fru* and *dsx* were not model inputs, yet both candidates are annotated *fru*-positive (fru_low in 2 of 2 neurons each). Among the 11,271 other isomorphic types, 587 carry such an annotation (one-sided Fisher exact test, p = 0.0027).

This agreement makes the two types reasonable candidates for further investigation, not evidence that they are dimorphic. A high score says a type sits in the same circuits as known sex-related types. Establishing dimorphism requires comparison with the female connectome or with light-microscopy anatomy.

| cell type | neurons | probability | *fru*/*dsx* | sex-related partners |
|---|---|---|---|---|
| CL062_b3 | 2 | 0.995 | fru_low (2/2) | 63% |
| CL062_b2 | 2 | 0.993 | fru_low (2/2) | 69% |

## Structural redundancy around the Giant Fiber

DNp01 is the only intermediate type on the LPLC2 → TTMn route (probability 0.024), so it is the type removed. Deleting it disconnects none of the three routes.

| route | with DNp01 | without DNp01 | output-share product |
|---|---|---|---|
| LPLC2 → TTMn | via DNp01, 2 hops | via DNp103, IN07B054, IN21A027, 4 hops | 9.45 × 10⁻⁴ → 4.92 × 10⁻⁶ |
| LC4 → TTMn | via DNp01, 2 hops | via DNp11, IN21A026, 3 hops | 1.64 × 10⁻³ → 1.55 × 10⁻⁴ |
| LPLC2 → DLMn c-f | via DNp01, IN18B034, 3 hops | via LPLC4, DNp31, 3 hops | 1.39 × 10⁻⁴ → 2.83 × 10⁻⁵ |

The best remaining route from LPLC2 to TTMn is twice as long, and its product of output shares is about 190 times smaller. The graph contains alternative synaptic routes to the jump motor neuron, but none as direct as the Giant Fiber.

## Interactive demo

A static site at <https://dhruvin-sarkar.github.io/ConnectomeLens/> presents the results in five sections:

- **Findings**, an illustrated article with twelve interactive figures: the type census, a wiring similarity map, precision-recall curves, the rewiring procedure and null distributions, SHAP attributions, the feature-set comparison, wiring communities, neuropil agreement, topology distributions, limitations, the candidate types with reconstructed skeletons, and the Giant Fiber route with node removal
- **Atlas**, every cell type and neuropil with its score, SHAP contributions, synapse locations, graph-position percentiles, strongest partners and a reconstructed neuron drawn inside the brain
- **Circuits**, 17 curated routes between sensory, courtship, descending and motor cell types, with node removal
- **Guess the Neuron**, a ten-round game pairing a sex-related type with an isomorphic type of the same superclass and dominant neuropil
- **Methods**, this report with full tables of features, settings, folds, null model, calibration, node removal, pre-specified checks and software

Every value on the site is exported from the result files by a script, and a check script compares the two.

# Discussion

The main result is that male wiring, taken alone, carries a signature of which cell types are sex-related, and that the degree sequence does not explain it. The signature is strongest in the topology-only model: randomized graphs with the same degrees score near chance, while the real graph scores seven times higher. For the full model, real wiring adds a modest increment (0.759 against 0.712) over a baseline that is already high because neuropil location is informative.

Two readings fit these results, and they are not exclusive. The classifier may detect circuit organization; Berg et al. describe male-specific connections organized into hotspots in higher centers. It may also detect the anatomical clustering of male-specific neuron families that share lineages, neuropils and partners. The hemilineage-grouped result (0.701) suggests lineage clustering explains part of the score, not all of it. Neither reading requires any claim about function.

The weaker performance on dimorphic types is the more informative limitation. A dimorphic neuron exists in both sexes and differs in its arbor or partners. Detecting that from one sex means recognizing a type as atypical relative to an unseen counterpart, which is harder than recognizing membership of a male-specific cluster. The failed named-type check points the same way: AOTU008 differs by two additional projections, a morphological detail that aggregated type-level features cannot express.

The candidate rule is strict and returns two types. Their independent *fru* annotation is encouraging but partly expected, since *fru*-expressing neurons populate the circuits the model keys on. It is not a validation of dimorphism.

The pathfinder and node-removal results support the graph construction rather than the classifier. Recovering LPLC2 → DNp01 → TTMn shows that the type graph and its weighting preserve a known sensory-to-motor pathway. The removal analysis describes which alternative routes exist in the graph, not what a fly without a Giant Fiber would do.

# What this does and does not show

The analysis shows that a classifier trained only on the male connectome ranks the published sex-related cell types far above chance, with a cross-validated AUC-PR of 0.759 against 0.041. It also shows that real connectivity predicts the labels better than degree-preserving randomized connectivity, with p = 0.002 for both pre-specified tests. These are statistical associations between a type's position in the wiring diagram and an existing annotation. They are correlational: they do not show that wiring causes or results from sexual dimorphism, and they say nothing about fly behavior.

The two high-scoring isomorphic-labeled types are candidates for further investigation, not discoveries. Their scores indicate that they are wired like known sex-related types; this report does not identify any new dimorphic neurons. The node-removal analysis describes the alternative synaptic routes that remain once a type is deleted from the graph. It is a statement about structural redundancy, not about the behavioral consequences of losing a neuron. Every number reported here is taken from result files written by the analysis code in the repository, and the report has not been peer reviewed.

# Limitations

- **Label provenance.** No feature comes from the female brain, but the labels themselves come from Janelia's male–female comparison.
- **Anatomy carries most of the signal.** Neuropil output shares alone reach an AUC-PR of 0.722; real wiring adds a small but consistent increment on top.
- **Scope.** The data are a single animal at cell-type resolution, with chemical synapses only.
- **Fixed choices.** The 1% edge threshold and the hyperparameters were fixed before evaluation; other choices would change the topology features.
- **Precision of p.** With 500 randomized graphs, p = 0.002 is a floor rather than a precise estimate.
- **Calibration.** The probabilities rank types but overstate how often a type is sex-related.
- **Label confidence.** The labels include lower-confidence "potentially" annotations.

# References

Ache JM, Polsky J, Alghailani S, et al. (2019). Neural basis for looming size and velocity encoding in the *Drosophila* giant fiber escape pathway. *Current Biology* 29(6):1073–1081.e4. doi:10.1016/j.cub.2019.01.079

Berg S, Beckett IR, Costa M, et al. (2026). Sexual dimorphism in the complete *Drosophila* male central nervous system connectome. *Cell* 189(18):5504–5526.e15. doi:10.1016/j.cell.2026.08.015

Csardi G, Nepusz T (2006). The igraph software package for complex network research. *InterJournal Complex Systems* 1695.

Dorkenwald S, Matsliah A, Sterling AR, et al. (2024). Neuronal wiring diagram of an adult brain. *Nature* 634:124–138. doi:10.1038/s41586-024-07558-y

HHMI Janelia FlyEM. Male CNS connectome, neuPrint dataset male-cns:v1.0. <https://neuprint.janelia.org>

Januszewski M, Jain V (2026). A connectomics milestone: Mapping the complete male fruit fly brain. Google Research blog, 3 September 2026. <https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/>

Ke G, Meng Q, Finley T, et al. (2017). LightGBM: a highly efficient gradient boosting decision tree. *Advances in Neural Information Processing Systems* 30.

Lappalainen JK, Tschopp FD, Prakhya S, et al. (2024). Connectome-constrained networks predict neural activity across the fly visual system. *Nature* 634:1132–1140. doi:10.1038/s41586-024-07939-3

Lundberg SM, Lee S-I (2017). A unified approach to interpreting model predictions. *Advances in Neural Information Processing Systems* 30. arXiv:1705.07874

Maslov S, Sneppen K (2002). Specificity and stability in topology of protein networks. *Science* 296(5569):910–913. doi:10.1126/science.1065103

Phipson B, Smyth GK (2010). Permutation p-values should never be zero: calculating exact p-values when permutations are randomly drawn. *Statistical Applications in Genetics and Molecular Biology* 9(1):39. doi:10.2202/1544-6115.1585

Plaza SM, Clements J, Dolafi T, et al. (2022). neuPrint: an open access tool for EM connectomics. *Frontiers in Neuroinformatics* 16:896292. doi:10.3389/fninf.2022.896292

Schlegel P, Barnes C, Loesche F, et al. navis: neuron analysis and visualization, version 1.12.0. Zenodo. doi:10.5281/zenodo.4699382

Schlegel P, Yin Y, Bates AS, et al. (2024). Whole-brain annotation and multi-connectome cell typing of *Drosophila*. *Nature* 634:139–152. doi:10.1038/s41586-024-07686-5

Traag VA, Waltman L, van Eck NJ (2019). From Louvain to Leiden: guaranteeing well-connected communities. *Scientific Reports* 9:5233. doi:10.1038/s41598-019-41695-z

von Reyn CR, Breads P, Peek MY, et al. (2014). A spike-timing mechanism for action selection. *Nature Neuroscience* 17(7):962–970. doi:10.1038/nn.3741
