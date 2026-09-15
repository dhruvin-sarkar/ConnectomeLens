import { useEffect, useMemo, useState } from "react";
import { ErrorNote, Loading, REPO, REPORT_PDF, Segmented, Sidenote, TypeLink } from "../components/ui.jsx";
import { NeuropilAgreementFigure, TopologyFigure } from "../figures/Anatomy.jsx";
import { AttributionFigure, CommunitiesFigure, FeatureSetsFigure } from "../figures/Attribution.jsx";
import BrainStain from "../figures/BrainStain.jsx";
import LimitsFigure from "../figures/Limits.jsx";
import { CandidatesFigure, CircuitFigure, shareProduct } from "../figures/Neurons.jsx";
import { NullDistribution, RewireDemo } from "../figures/NullModel.jsx";
import RankingExplorer from "../figures/RankingExplorer.jsx";
import TypeCensus from "../figures/TypeCensus.jsx";
import WiringMap from "../figures/WiringMap.jsx";
import { loadCandidates, loadDiagnostics, loadExplanations, loadMap, loadRoutes, loadSummary, loadTypes } from "../lib/data.js";
import { featureLabel, integer, millions, neuropilName, percent } from "../lib/format.js";
import { useAll } from "../lib/hooks.js";
import { href } from "../lib/route.js";

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** "a, b and c" from rendered items. */
function Series({ items }) {
  return items.map((item, i) => (
    <span key={i}>
      {item}
      {i < items.length - 2 ? ", " : i === items.length - 2 ? " and " : ""}
    </span>
  ));
}

function Hero({ summary }) {
  const [channel, setChannel] = useState("merge");
  const { classifier: c, nullModel: n } = summary;
  const sexRelated = summary.labelCounts.male_specific + summary.labelCounts.dimorphic;
  return (
    <header className="hero">
      <div className="hero-plate">
        <BrainStain
          mode={channel}
          label="Rotating three-dimensional model of the male fly brain, neuropils colored by classifier probability and annotation"
        />
      </div>
      <div className="hero-copy">
        <h1 className="hero-title">Wired Different</h1>
        <p className="hero-deck">Can the wiring diagram of a male fruit fly tell which of its cell types differ between the sexes?</p>
        <p className="hero-answer">
          A classifier that sees only the male connectome tends to rank the {integer(sexRelated)} cell types annotated as
          sex-related ahead of the rest, with AUC-PR <strong>{c.auc_pr.toFixed(3)}</strong> where a random ranking scores{" "}
          {c.baseline_auc_pr.toFixed(3)}. None of {n.n_trials} randomized wirings did as well (p ={" "}
          {n.full.p_value.toFixed(3)}).
        </p>
        <div className="hero-actions">
          <button type="button" className="button button-field" onClick={() => scrollTo("question")}>
            Read the findings
          </button>
          <a className="button button-field-quiet" href={href("atlas")}>
            Explore the atlas
          </a>
          <a className="button button-field-quiet" href={href("game")}>
            Play Guess the Neuron
          </a>
        </div>
      </div>
      <div className="hero-legend">
        <Segmented
          tone="field"
          label="Stain"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "prediction", label: "Classifier", swatch: "prediction" },
            { value: "annotation", label: "Annotation", swatch: "annotation" },
            { value: "merge", label: "Merge", swatch: "merge" },
          ]}
        />
        <p>
          {channel === "prediction" && "Magenta: mean classifier probability of the cell types making synapses in each neuropil. "}
          {channel === "annotation" && "Green: share of each neuropil's synapses made by types Janelia annotates as dimorphic or male-specific. "}
          {channel === "merge" && "Magenta is the classifier and green the annotation; neuropils where both are high glow white. "}
          Drag to turn the brain.
        </p>
      </div>
    </header>
  );
}

function Chapter({ id, title, children }) {
  return (
    <section className="chapter" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="chapter-title" id={`${id}-title`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextBlock({ children, notes }) {
  return (
    <div className="text-grid">
      <div className="prose">{children}</div>
      {notes && <div className="notes">{notes}</div>}
    </div>
  );
}

function Num({ children }) {
  return <span className="num">{children}</span>;
}

export default function Findings() {
  const data = useAll([loadSummary, loadDiagnostics, loadTypes, loadMap, loadRoutes, loadCandidates]);
  const [explanations, setExplanations] = useState(null);

  useEffect(() => {
    if (data.value) loadExplanations().then(setExplanations, () => setExplanations({}));
  }, [data.value]);

  const derived = useMemo(() => {
    if (!data.value) return null;
    const [summary, d] = data.value;
    const communities = d.communities.communities.filter((x) => x.community >= 0);
    const main = communities.reduce((a, b) => (b.male_specific + b.dimorphic > a.male_specific + a.dimorphic ? b : a));
    const neuropilDrivers = d.attribution.features
      .filter((f) => f.group === "neuropil" && !f.feature.includes("unspecified"))
      .sort((a, b) => b.mean_shap_sex_related - a.mean_shap_sex_related)
      .slice(0, 3)
      .map((f) => f.feature.replace("out_frac_", ""));
    const hotNeuropils = [];
    for (const row of [...d.neuropil_agreement.neuropils].sort((a, b) => b.score - a.score)) {
      const base = row.neuropil.replace(/\([LR]\)$/, "");
      if (!hotNeuropils.includes(base) && neuropilName(base)) hotNeuropils.push(base);
      if (hotNeuropils.length === 4) break;
    }
    const hops = d.topology_by_label.find((t) => t.feature === "hops_to_motor").quantiles;
    return { main, neuropilDrivers, hotNeuropils, hops, ablation: summary.ablation.pairs[0] };
  }, [data.value]);

  if (data.error) {
    return (
      <div className="chapter">
        <ErrorNote>{data.error}</ErrorNote>
      </div>
    );
  }
  if (!derived) return <Loading>Loading the findings</Loading>;

  const [summary, d, types, xy, routes, candidates] = data.value;
  const { main, neuropilDrivers, hotNeuropils, hops, ablation } = derived;
  const c = summary.classifier;
  const n = summary.nullModel;
  const counts = summary.labelCounts;
  const sexRelated = counts.male_specific + counts.dimorphic;
  const sets = d.feature_sets;
  const groups = d.attribution.groups;
  const baseline = c.baseline_auc_pr;
  const folds = c.fold_auc_pr;
  const top1 = d.top_fraction_capture[0];
  const named = d.named_types;
  const { before, after } = ablation;
  const hopWord = (v) => `${v} ${v === 1 ? "hop" : "hops"}`;

  return (
    <article className="findings">
      <Hero summary={summary} />

      <Chapter id="question" title="Two connectomes, one question">
        <TextBlock
          notes={
            <>
              <Sidenote title="Three labels">
                Isomorphic types look the same in both sexes. Dimorphic types exist in both but differ in shape or wiring.
                Male-specific types are found only in males.
              </Sidenote>
              <Sidenote title="Why AUC-PR">
                With {percent(sexRelated / summary.nTypes)} of types positive, calling everything isomorphic would be{" "}
                {percent(counts.isomorphic / summary.nTypes)} accurate and useless. AUC-PR measures how well the positives
                are ranked first; a random ranking scores the positive rate, {baseline.toFixed(3)}.
              </Sidenote>
              <Sidenote title="Typed neurons">
                {integer(summary.nTypedNeurons)} of the reconstructed neurons have a cell type in neuPrint, and only
                those are used here.
              </Sidenote>
            </>
          }
        >
          <p>
            HHMI Janelia&apos;s FlyEM team and Google Research have released the complete connectome of an adult male
            fruit fly&apos;s central nervous system: brain and ventral nerve cord, which Berg et al. (2026) report as about
            166,700 neurons reconstructed synapse by synapse from electron microscopy. Set beside the female FlyWire brain,
            it let the authors label each matched cell type as isomorphic, dimorphic or specific to one sex.
          </p>
          <p>
            Those labels come from comparing two connectomes. This project asks a narrower question: does a cell
            type&apos;s place in the male wiring, taken on its own, carry a trace of whether the type is sex-related? If
            it does, wiring could help decide where to look when only one sex has been mapped.
          </p>
          <p>
            Aggregated over the {integer(summary.nTypes)} cell types in the male data, Janelia&apos;s annotations give{" "}
            <Num>{integer(counts.male_specific)}</Num> male-specific, <Num>{integer(counts.dimorphic)}</Num> dimorphic and{" "}
            <Num>{integer(counts.isomorphic)}</Num> isomorphic types. A male nervous system cannot contain female-specific
            types, so the task is binary: sex-related (dimorphic or male-specific) against isomorphic.
          </p>
        </TextBlock>
        <TypeCensus types={types.list} number={1} />
      </Chapter>

      <Chapter id="graph" title="From synapses to a graph of cell types">
        <ol className="pipeline" aria-label="Analysis steps">
          <li>
            <span className="pipeline-value">{integer(summary.nTypedNeurons)}</span>
            <span className="pipeline-text">typed neurons from neuPrint, dataset male-cns v1.0</span>
          </li>
          <li>
            <span className="pipeline-value">{millions(summary.nTypePairs)}</span>
            <span className="pipeline-text">connected pairs of cell types, carrying {millions(summary.typePairSynapses)} synapses</span>
          </li>
          <li>
            <span className="pipeline-value">{integer(summary.nEdges)}</span>
            <span className="pipeline-text">
              connections kept, each supplying at least 1% of the receiving type&apos;s input ({millions(summary.edgeSynapses)} synapses)
            </span>
          </li>
          <li>
            <span className="pipeline-value">{c.feature_sets.full.n_features}</span>
            <span className="pipeline-text">
              features per type: {c.feature_sets.topology_only.n_features} for its place in the graph,{" "}
              {c.feature_sets.static_only.n_features - 1} for where it sends synapses and 1 for its transmitter
            </span>
          </li>
          <li>
            <span className="pipeline-value">{c.n_folds}</span>
            <span className="pipeline-text">cross-validation folds, so every type is scored by a model that never saw its label</span>
          </li>
        </ol>
        <TextBlock
          notes={
            <Sidenote title="Graph features">
              In- and out-degree, in- and out-strength, PageRank, betweenness centrality, Leiden community, and hop
              distances from the nearest sensory type and to the nearest descending or motor type.
            </Sidenote>
          }
        >
          <p>
            Neurons of the same type were merged and their synapses summed into weighted connections between types. The
            classifier, a gradient-boosted tree model (LightGBM) with settings fixed before evaluation, sees only
            features computed from the male data. Nothing comes from the female brain. Expression of <i>fruitless</i> and{" "}
            <i>doublesex</i>, the genes that set up many sex-specific neurons, was left out as well because it would give
            the answer away; it is used only to check candidates afterwards.
          </p>
          <p>
            The map below places every type by the similarity of its connections. The annotated sex-related types do not
            scatter at random: most gather in one dense region, and the classifier&apos;s scores light up the same region.
          </p>
        </TextBlock>
        <WiringMap types={types.list} xy={xy} number={2} />
      </Chapter>

      <Chapter id="ranking" title="The male wiring predicts the labels">
        <TextBlock
          notes={
            <Sidenote title="Out-of-fold">
              Types are split into {c.n_folds} groups. Each group is scored by a model trained on the other {c.n_folds - 1}
              , so no type&apos;s own label ever informs its score.
            </Sidenote>
          }
        >
          <p>
            Ranked by out-of-fold probability, the annotated sex-related types rise to the top. Of the{" "}
            <Num>{integer(top1.k)}</Num> highest-scoring types, the top 1%, <Num>{integer(top1.sex_related)}</Num> are
            annotated sex-related. Over the whole ranking the classifier reaches AUC-PR <Num>{c.auc_pr.toFixed(3)}</Num>{" "}
            against {baseline.toFixed(3)} for a random ranking, with ROC AUC {c.roc_auc.toFixed(3)}, and the five folds
            range from {Math.min(...folds).toFixed(3)} to {Math.max(...folds).toFixed(3)}.
          </p>
          <p>
            Two stricter versions hold up. Keeping every developmental hemilineage inside one fold, so sibling types
            cannot vouch for each other, gives <Num>{c.hemilineage_grouped_cv.auc_pr.toFixed(3)}</Num>. Using graph topology
            alone, with no information about where synapses are made, gives{" "}
            <Num>{c.feature_sets.topology_only.auc_pr.toFixed(3)}</Num>.
          </p>
        </TextBlock>
        <RankingExplorer diagnostics={d} number={3} nSexRelated={sexRelated} baseline={baseline} />
      </Chapter>

      <Chapter id="null-model" title="Not explained by how many partners each type has">
        <TextBlock
          notes={
            <Sidenote title="Specified in advance">
              The randomization, both tests and the Bonferroni correction were written down before the first randomized
              graph was scored. The model did not change afterwards.
            </Sidenote>
          }
        >
          <p>
            A good score does not yet show that <em>who connects to whom</em> matters. Cell types differ enormously in
            size, and a classifier could separate the classes from the degree sequence alone: how many partners each type
            has, whoever they are. The test is to keep that sequence and scramble everything else.
          </p>
        </TextBlock>
        <div className="inline-figure">
          <RewireDemo nEdges={summary.nEdges} />
        </div>
        <TextBlock>
          <p>
            Each of {n.n_trials} randomized graphs keeps every type&apos;s exact number of inputs and outputs, and its
            total outgoing synapses, while partners are shuffled. Every topology feature was recomputed and the identical
            model retrained on the real labels with the same folds.
          </p>
          <p>
            None of the {n.n_trials} scored as well as the real wiring. With all features, randomized graphs reached{" "}
            <Num>
              {n.full.null_mean.toFixed(3)} ± {n.full.null_sd.toFixed(3)}
            </Num>{" "}
            and never more than {n.full.null_max.toFixed(3)}, against {n.full.real.toFixed(3)} for the real graph (p ={" "}
            {n.full.p_value.toFixed(3)}). With topology features alone the gap is much wider:{" "}
            <Num>{n.topology_only.real.toFixed(3)}</Num> against{" "}
            <Num>
              {n.topology_only.null_mean.toFixed(3)} ± {n.topology_only.null_sd.toFixed(3)}
            </Num>{" "}
            (p = {n.topology_only.p_value.toFixed(3)}).
          </p>
        </TextBlock>
        <NullDistribution diagnostics={d} nullModel={n} number={4} />
      </Chapter>

      <Chapter id="features" title="What the classifier relies on">
        <TextBlock
          notes={
            <Sidenote title="SHAP">
              Shapley additive explanations divide a prediction into one contribution per feature. The contributions plus
              a baseline add up exactly to the model&apos;s score for that type.
            </Sidenote>
          }
        >
          <p>
            Most of the signal is location. SHAP attributions assign <Num>{percent(groups.neuropil.share, 0)}</Num> of the
            model&apos;s total contribution to where a type sends its synapses,{" "}
            <Num>{percent(groups.topology.share, 0)}</Num> to its position in the graph and{" "}
            <Num>{percent(groups.transmitter.share, 0)}</Num> to its predicted transmitter. For annotated sex-related types,
            output in the <Series items={neuropilDrivers.map((r) => `${neuropilName(r)} (${r})`)} /> raises scores most.
          </p>
          <p>
            The largest single topology contribution comes from {featureLabel(d.attribution.features[0].feature)}, which
            is also the most important feature overall. <Num>{integer(main.male_specific + main.dimorphic)}</Num> of the {integer(sexRelated)}{" "}
            sex-related types fall in one Leiden community of {integer(main.n_types)} types, whose output centers on{" "}
            <Series items={main.top_neuropils.map(([r]) => r)} />. Community membership alone scores{" "}
            {sets.community_only.auc_pr.toFixed(3)}, and the other topology features without it score{" "}
            {sets.topology_without_community.auc_pr.toFixed(3)}.
          </p>
        </TextBlock>
        <AttributionFigure diagnostics={d} number={5} />
        <TextBlock>
          <p>
            The comparisons below were run after the null-model test to describe the model, not to improve it. Neuropil
            output shares alone reach {sets.neuropil_only.auc_pr.toFixed(3)}, close to the full model&apos;s{" "}
            {sets.full.auc_pr.toFixed(3)}. Wiring adds to location rather than replacing it, which is why the topology-only
            test matters.
          </p>
        </TextBlock>
        <FeatureSetsFigure diagnostics={d} baseline={baseline} number={6} />
        <CommunitiesFigure diagnostics={d} number={7} />
      </Chapter>

      <Chapter id="anatomy" title="Where in the nervous system">
        <TextBlock>
          <p>
            Averaging the probabilities over synapses turns the ranking into a map. The neuropils that glow brightest in
            the brain at the top of the page are the{" "}
            <Series items={hotNeuropils.map((r) => `${neuropilName(r)} (${r})`)} />. The share of their synapses made by
            annotated sex-related types follows the same order.
          </p>
          <p>
            Sex-related types also occupy a different place in the graph. They tend to be better connected and more
            central, and they sit closer to motor output: a median of {hopWord(hops.male_specific[2])} to a descending or
            motor type for male-specific types and {hopWord(hops.dimorphic[2])} for dimorphic types, against{" "}
            {hopWord(hops.isomorphic[2])} for isomorphic types. The differences are consistent but modest, which is why
            topology on its own predicts only moderately well.
          </p>
        </TextBlock>
        <NeuropilAgreementFigure diagnostics={d} number={8} />
        <TopologyFigure diagnostics={d} number={9} />
      </Chapter>

      <Chapter id="limits" title="Where it falls short">
        <TextBlock>
          <p>
            The headline number hides real weaknesses. Male-specific types, found only in males, are ranked far better
            (AUC-PR <Num>{c.per_class.male_specific.auc_pr.toFixed(3)}</Num>) than dimorphic types, which exist in both
            sexes with different wiring (<Num>{c.per_class.dimorphic.auc_pr.toFixed(3)}</Num>). Performance is strong among
            central brain intrinsic types and weak among descending and nerve cord types.
          </p>
          <p>
            A sanity check fixed before training also failed. It required at least one of four sex-related types named in
            public announcements of the connectome to rank in the top 20.{" "}
            <Series items={named.map((t) => <TypeLink key={t.cell_type} name={t.cell_type} />)} /> rank between{" "}
            {integer(Math.min(...named.map((t) => t.rank)))} and {integer(Math.max(...named.map((t) => t.rank)))}. The check
            was not loosened and is reported as failed.
          </p>
        </TextBlock>
        <LimitsFigure diagnostics={d} types={types.list} number={10} />
      </Chapter>

      <Chapter id="candidates" title="Two candidates for a closer look">
        <TextBlock
          notes={
            <Sidenote title="Not a finding of dimorphism">
              A high score says a type is wired like known sex-related types. Showing that it differs between the sexes
              needs the female connectome or light-microscopy anatomy.
            </Sidenote>
          }
        >
          <p>
            Where the classifier scores a type highly but the annotation says isomorphic, the type may be worth a second
            look. The rule, fixed in advance, was annotated isomorphic types in the top 1% of all scores. Two types qualify,
            both from the CL062 family:{" "}
            <Series items={candidates.map((x) => <TypeLink key={x.cell_type} name={x.cell_type} />)} />. Both sit in the
            community that holds most sex-related types, and{" "}
            <Series items={candidates.map((x) => percent(x.sex_related_partner_share, 0))} /> of their partners in the
            thresholded graph, respectively, are annotated sex-related.
          </p>
          <p>
            Both carry a <i>fruitless</i> annotation, which the model never saw. That overlap is unlikely to be chance (p ={" "}
            {summary.candidates.fisher_p_value.toFixed(4)}), but it rests on two types, and <i>fruitless</i>-expressing
            neurons are common in the circuits the model relies on, so it is not independent confirmation.
          </p>
        </TextBlock>
        <CandidatesFigure candidates={candidates} types={types} explanations={explanations} summary={summary} number={11} />
      </Chapter>

      <Chapter id="circuit" title="A circuit the graph recovers on its own">
        <TextBlock>
          <p>
            To check the graph itself, independently of any label, a shortest-path search looked for the strongest synaptic
            route from LPLC2, a visual neuron that responds to looming objects, to TTMn, the motor neuron that powers the
            escape jump. It runs through DNp01, the Giant Fiber: the textbook escape circuit.
          </p>
          <p>
            Deleting the Giant Fiber from the graph shows what remains. The best detour from LPLC2 needs{" "}
            <Num>{after.hops}</Num> hops instead of {before.hops}, and the product of output shares along it falls from{" "}
            {shareProduct(before)} to {shareProduct(after)}, about {integer(Math.exp(after.cost - before.cost))} times lower.
            That describes redundancy in the wiring, not what a fly would do.
          </p>
        </TextBlock>
        <CircuitFigure routes={routes} types={types} number={12} />
      </Chapter>

      <Chapter id="claims" title="What this shows, and what it does not">
        <div className="claims">
          <div>
            <h3>It shows</h3>
            <ul>
              <li>
                The male wiring alone predicts Janelia&apos;s sex-related annotations well above chance, at AUC-PR{" "}
                {c.auc_pr.toFixed(3)} against {baseline.toFixed(3)}.
              </li>
              <li>
                Real connectivity carries more of that signal than randomized wiring with the same degrees (p ={" "}
                {n.full.p_value.toFixed(3)} with all features, p = {n.topology_only.p_value.toFixed(3)} with topology
                alone).
              </li>
              <li>Which annotated isomorphic types are wired like sex-related ones, as candidates for further investigation.</li>
              <li>Which alternative synaptic routes exist when a cell type is removed from the graph.</li>
            </ul>
          </div>
          <div>
            <h3>It does not show</h3>
            <ul>
              <li>Any new dimorphic or sex-specific neuron. The candidates remain candidates.</li>
              <li>Anything causal about behavior. Every result here is correlational or structural.</li>
              <li>
                A signal independent of anatomy: much of it is where types make synapses, and the labels themselves come
                from comparing male and female connectomes.
              </li>
              <li>Peer-reviewed science. This is an independent analysis of public data.</li>
            </ul>
          </div>
        </div>
        <TextBlock>
          <p>
            The graph counts chemical synapses only, at the level of cell types, and keeps connections supplying at least
            1% of the receiving type&apos;s input, a threshold chosen before any model was trained. Labels are used regardless of annotation confidence, as in Berg
            et al. Every table, parameter and reference is in the <a href={href("methods")}>methods</a> and the{" "}
            <a href={REPORT_PDF}>technical report</a>.
          </p>
        </TextBlock>
      </Chapter>

      <Chapter id="explore" title="Explore, reproduce, cite">
        <ul className="explore">
          <li>
            <a href={href("atlas")}>Atlas</a>
            <p>Every cell type and neuropil, with its score, the features behind it, its partners and its morphology.</p>
          </li>
          <li>
            <a href={href("circuits")}>Circuits</a>
            <p>{routes.length} routes between sensory, courtship, descending and motor cell types, with node removal.</p>
          </li>
          <li>
            <a href={href("game")}>Guess the Neuron</a>
            <p>Two neurons, one of them sex-related. Pick it in ten rounds, then compare with the classifier.</p>
          </li>
        </ul>
        <div className="reproduce">
          <div>
            <h3>Reproduce</h3>
            <p>
              Every number on this page is read from files written by the pipeline in the <a href={REPO}>repository</a>.
              From a clean checkout with Python 3.12:
            </p>
            <pre>
              <code>{`pip install -r requirements.txt
make reproduce`}</code>
            </pre>
          </div>
          <div>
            <h3>Cite the data</h3>
            <p className="citation">
              Berg S, Beckett IR, Costa M, et al. (2026). Sexual dimorphism in the complete <i>Drosophila</i> male central
              nervous system connectome. <i>Cell</i> 189(18):5504–5526.e15.{" "}
              <a href="https://doi.org/10.1016/j.cell.2026.08.015">doi:10.1016/j.cell.2026.08.015</a>
            </p>
          </div>
        </div>
      </Chapter>
    </article>
  );
}
