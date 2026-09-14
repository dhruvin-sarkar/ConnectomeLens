# Launch kit

Drafts for announcing the project. Every number below comes from `results/` and matches the technical report. Links: demo <https://dhruvin-sarkar.github.io/ConnectomeLens/>, code <https://github.com/dhruvin-sarkar/ConnectomeLens>.

## Thread (7 posts)

**1** (attach `assets/hero.png`)
HHMI Janelia and Google Research released the complete connectome of a male fruit fly's central nervous system. Can the male wiring alone tell which cell types differ between the sexes? A classifier trained only on the male data reaches AUC-PR 0.759 (chance: 0.041).

**2** (attach `results/null_distribution.png`)
High scores can come from trivial structure, like how many partners a cell type has. So I rewired the graph 500 times, keeping every type's degrees. None of the randomized graphs matched the real wiring: p = 0.002. Topology features alone: 0.489 real vs 0.070 randomized.

**3**
To check the graph, I searched for the strongest synaptic route from the looming detector LPLC2 to the jump motor neuron TTMn. It runs through the Giant Fiber (DNp01), the textbook escape circuit. Remove it and the best detour takes 4 hops, not 2.

**4**
The demo has 17 curated sensory-to-motor routes. Watch the signal step through real reconstructed neurons, then remove any intermediate cell type to see which alternative routes the graph holds. Structure only: it says nothing about what a fly would do.

**5**
Two cell types annotated isomorphic score in the top 1%: CL062_b2 and CL062_b3. Both carry fru annotations, which the model never saw. That makes them candidates for further investigation, nothing more. Showing dimorphism needs the female connectome or anatomy.

**6**
Caveats: labels come from Janelia's male–female comparison; much of the signal is neuropil location; dimorphic types (AUC-PR 0.376) are far harder than male-specific ones (0.832); AOTU008, the example in Google's post, ranks 531st. Correlational and not peer reviewed.

**7**
Atlas, pathfinder and Guess the Neuron game: https://dhruvin-sarkar.github.io/ConnectomeLens/
Code, report and `make reproduce`: https://github.com/dhruvin-sarkar/ConnectomeLens
Data: HHMI Janelia FlyEM and Google Research, Berg et al., Cell 2026, doi:10.1016/j.cell.2026.08.015

## Show HN

**Title:** Show HN: Can a fly's wiring diagram tell which neurons differ between the sexes?

**Text:**

HHMI Janelia FlyEM and Google Research published the connectome of the entire male *Drosophila* central nervous system this month (Berg et al., Cell 2026): about 166,700 neurons, 125 million synapses, and labels for which cell types are isomorphic, dimorphic or male-specific relative to the female brain.

I built a cell-type graph from the male data only (11,751 types, 243k weighted edges) and trained LightGBM on graph topology plus where each type sends its synapses. Out-of-fold AUC-PR is 0.759 against a 0.041 base rate.

The part I cared most about is the null model. I ran 500 degree-preserving rewirings of the graph, recomputed every topology feature, and retrained with identical folds. The real graph beat all 500 (p = 0.002; 0.712 ± 0.005 on randomized graphs). With topology features alone it is 0.489 real vs 0.070 randomized.

Other pieces:

- a weighted shortest-path search that recovers the Giant Fiber escape circuit (LPLC2 → DNp01 → TTMn)
- a node-removal analysis
- a static React/three.js demo with a guessing game

What it does not show: any new dimorphic neuron (two candidates are flagged, hedged), causation, or behavior. Much of the signal is neuropil location, dimorphic types are much harder than male-specific ones, and a sanity check on named example neurons failed. The README reports that failure rather than hiding it. Everything reproduces with `make reproduce` from public neuPrint data.

Demo: https://dhruvin-sarkar.github.io/ConnectomeLens/
Code and report: https://github.com/dhruvin-sarkar/ConnectomeLens

## Reddit (r/neuroscience)

**Title:** Predicting sexually dimorphic cell types from the male Drosophila connectome's wiring alone, tested against 500 degree-preserving null graphs

**Body:**

The male CNS connectome from HHMI Janelia FlyEM and Google Research (Berg et al., *Cell* 2026, doi:10.1016/j.cell.2026.08.015) annotates which cell types are dimorphic or male-specific by comparison with the female FlyWire brain. I wanted to know how much of that is visible in the male wiring by itself.

**Setup.** I built a type-level graph from neuPrint's `male-cns:v1.0`, keeping edges that supply at least 1% of a type's input. The features are:

- degree, strength, PageRank, betweenness, Leiden community and hop distances from sensory and to motor types
- output shares per neuropil and predicted transmitter

*fru*/*dsx* was excluded as a leak. I used LightGBM with fixed hyperparameters and 5-fold stratified cross-validation.

**Results (all out-of-fold):**

- AUC-PR 0.759 (chance 0.041); male-specific 0.832, dimorphic 0.376
- 500 degree-preserving rewirings, topology features recomputed: 0.712 ± 0.005, none ≥ real, p = 0.002
- topology features only: 0.489 real vs 0.070 randomized, p = 0.002
- hemilineage-grouped folds: 0.701

As a check on graph construction, the strongest route from LPLC2 to TTMn goes through the Giant Fiber (DNp01).

**Caveats I would flag first:**

- Static neuropil features alone reach 0.726, so the wiring's added value over location is modest in the full model.
- The labels depend on the male–female comparison.
- AOTU008, the dimorphic example in Google's announcement, ranks 531st.
- Two isomorphic-labeled types (CL062_b2, CL062_b3) score in the top 1% and are *fru*-annotated. They are candidates to look at, not claims of dimorphism.

I'd welcome criticism of the null model design in particular.

Demo (atlas, pathfinder, guessing game): https://dhruvin-sarkar.github.io/ConnectomeLens/
Code and technical report: https://github.com/dhruvin-sarkar/ConnectomeLens

## awesome-fly entry (draft)

For a pull request to `cobanov/awesome-fly`, following its `CONTRIBUTING.md`:

> **[Wired Different](https://github.com/dhruvin-sarkar/ConnectomeLens)**: classifier predicting sexually dimorphic cell types from male CNS connectome (male-cns v1.0) wiring, validated against degree-preserving null graphs; static demo with atlas, pathfinder and guessing game. Complete.
