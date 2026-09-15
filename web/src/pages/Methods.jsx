import { useEffect, useMemo, useState } from "react";
import { ErrorNote, LabelMark, Loading, REPO, REPORT_PDF, Segmented, TypeLink } from "../components/ui.jsx";
import { SET_LABELS } from "../figures/Attribution.jsx";
import { shareProduct } from "../figures/Neurons.jsx";
import { loadCandidates, loadDiagnostics, loadRoutes, loadSummary } from "../lib/data.js";
import {
  featureGroupLabel,
  featureLabel,
  integer,
  neuropilName,
  outcomeText,
  percent,
  scientific,
  superclassName,
} from "../lib/format.js";
import { useAll } from "../lib/hooks.js";
import { href } from "../lib/route.js";

const SECTIONS = [
  ["summary", "Summary"],
  ["data", "Data"],
  ["labels", "Labels"],
  ["graph", "Cell-type graph"],
  ["features", "Features"],
  ["model", "Classifier and evaluation"],
  ["performance", "Performance"],
  ["null-model", "Null model"],
  ["breakdown", "Where the signal sits"],
  ["calibration", "Calibration"],
  ["candidates", "Candidates"],
  ["routes", "Routes and node removal"],
  ["checks", "Pre-specified checks"],
  ["limitations", "Limitations"],
  ["software", "Software and reproduction"],
  ["references", "References"],
  ["cite", "How to cite"],
];

const fixed3 = (v) => (v == null ? "not computed" : v.toFixed(3));
const smallP = (p) => (p < 0.001 ? scientific(p, 1) : p.toFixed(3));
const signed = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(3)}`;

function Table({ number, caption, head, rows, numeric = [], wide = false }) {
  return (
    <div className={wide ? "table-wrap table-wide" : "table-wrap"}>
      <table className="data-table">
        <caption>
          <span className="table-number">Table {number}</span>
          {caption}
        </caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={numeric.includes(i) ? "num-col" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className={numeric.includes(i) ? "num-col" : undefined}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, index, title, children }) {
  return (
    <section className="methods-section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="methods-heading">
        <span className="methods-heading-number">{index}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Contents({ active }) {
  return (
    <nav className="methods-toc" aria-label="Contents">
      <p className="methods-toc-title">Contents</p>
      <ol>
        {SECTIONS.map(([id, title], i) => (
          <li key={id}>
            <button
              type="button"
              className={active === id ? "on" : ""}
              aria-current={active === id ? "true" : undefined}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <span className="toc-number">{i + 1}</span>
              {title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function FeatureTable({ features, number }) {
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState("importance");
  const rows = useMemo(() => {
    const kept = features.filter((f) => group === "all" || f.group === group);
    if (sort === "name") return [...kept].sort((a, b) => featureLabel(a.feature).localeCompare(featureLabel(b.feature)));
    return [...kept].sort((a, b) => b.mean_abs_shap - a.mean_abs_shap);
  }, [features, group, sort]);
  return (
    <>
      <div className="table-controls">
        <Segmented
          label="Feature group"
          value={group}
          onChange={setGroup}
          options={[
            { value: "all", label: `All ${features.length}` },
            { value: "neuropil", label: "Neuropil" },
            { value: "topology", label: "Topology" },
            { value: "transmitter", label: "Transmitter" },
          ]}
        />
        <Segmented
          label="Sort features"
          value={sort}
          onChange={setSort}
          options={[
            { value: "importance", label: "By importance" },
            { value: "name", label: "By name" },
          ]}
        />
      </div>
      <div className="table-scroll">
        <Table
          number={number}
          caption="Every model feature with its mean absolute SHAP value over all types, and its mean signed SHAP value within each class, in log-odds."
          head={["Feature", "Group", "Mean |SHAP|", "Mean, sex-related", "Mean, isomorphic"]}
          numeric={[2, 3, 4]}
          rows={rows.map((f) => [
            <>
              {featureLabel(f.feature)}
              <span className="cell-sub">{f.feature}</span>
            </>,
            featureGroupLabel[f.group],
            f.mean_abs_shap.toFixed(3),
            signed(f.mean_shap_sex_related),
            signed(f.mean_shap_isomorphic),
          ])}
        />
      </div>
    </>
  );
}

export default function Methods() {
  const data = useAll([loadSummary, loadDiagnostics, loadRoutes, loadCandidates]);
  const [active, setActive] = useState(SECTIONS[0][0]);

  useEffect(() => {
    if (!data.value) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const [id] of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [data.value]);

  if (data.error) {
    return (
      <div className="methods-page">
        <ErrorNote>{data.error}</ErrorNote>
      </div>
    );
  }
  if (!data.value) return <Loading>Loading the methods</Loading>;

  const [summary, d, routes, candidates] = data.value;
  const c = summary.classifier;
  const n = summary.nullModel;
  const counts = summary.labelCounts;
  const sexRelated = counts.male_specific + counts.dimorphic;
  const params = c.params;
  const cal = d.calibration;
  const quantile = (row, label) => {
    const q = row.quantiles[label];
    const f = (v) => (row.feature === "pagerank" ? scientific(v, 1) : integer(v));
    return `${f(q[2])} [${f(q[1])}–${f(q[3])}]`;
  };
  const sortedNeuropils = [...d.neuropil_agreement.neuropils].sort((a, b) => b.score - a.score);
  const namedPass = d.named_types.some((t) => t.rank <= 20);
  const giantFiber = routes.find((r) => r.source === "LPLC2" && r.target === "TTMn");
  const ablationRows = routes.flatMap((r) =>
    Object.entries(r.ablations).map(([removed, a]) => [
      `${r.source} to ${r.target}`,
      <TypeLink key={removed} name={removed} />,
      outcomeText(a.outcome),
      a.route ? a.route.hops : "none",
      a.route ? `${shareProduct(r.route)} to ${shareProduct(a.route)}` : "no route",
    ]),
  );
  let tableCount = 0;
  const next = () => {
    tableCount += 1;
    return tableCount;
  };
  const nullRows = [
    ["All features", n.full],
    ["Topology only", n.topology_only],
  ];

  return (
    <div className="methods-page">
      <header className="methods-head">
        <h1 className="methods-title">Methods and full results</h1>
        <p className="methods-deck">
          How every number on this site was produced, with the complete tables behind the figures. The same analysis is
          written up as a technical report.
        </p>
        <p className="methods-byline">Dhruvin Sarkar, 14 September 2026. An independent analysis of public data, not peer reviewed.</p>
        <div className="methods-actions">
          <a className="button" href={REPORT_PDF}>
            Technical report (PDF)
          </a>
          <a className="button button-quiet" href={REPO}>
            Code and pipeline
          </a>
          <a className="button button-quiet" href={href("findings")}>
            Illustrated findings
          </a>
        </div>
      </header>

      <div className="methods-layout">
        <Contents active={active} />
        <article className="methods-body prose">
          <Section id="summary" index={1} title="Summary">
            <p>
              A gradient-boosted classifier trained only on features of the male connectome ranks the {integer(sexRelated)}{" "}
              cell types that Janelia annotates as sex-related ahead of the {integer(counts.isomorphic)} isomorphic types,
              with out-of-fold AUC-PR {c.auc_pr.toFixed(3)} against a chance level of {c.baseline_auc_pr.toFixed(3)}. On{" "}
              {n.n_trials} degree-preserving randomized graphs the same model never matched that score (p ={" "}
              {n.full.p_value.toFixed(3)}). With topology features alone the real graph scores{" "}
              {n.topology_only.real.toFixed(3)} against {n.topology_only.null_mean.toFixed(3)} for randomized wiring (p ={" "}
              {n.topology_only.p_value.toFixed(3)}).
            </p>
            <dl className="key-numbers">
              <div>
                <dt>AUC-PR, all features</dt>
                <dd>{c.auc_pr.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Chance level</dt>
                <dd>{c.baseline_auc_pr.toFixed(3)}</dd>
              </div>
              <div>
                <dt>ROC AUC</dt>
                <dd>{c.roc_auc.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Hemilineages held out</dt>
                <dd>{c.hemilineage_grouped_cv.auc_pr.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Topology features only</dt>
                <dd>{c.feature_sets.topology_only.auc_pr.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Null model p, both tests</dt>
                <dd>{n.full.p_value.toFixed(3)}</dd>
              </div>
            </dl>
          </Section>

          <Section id="data" index={2} title="Data">
            <p>
              All data come from neuPrint (Plaza et al. 2022), dataset <code>{summary.dataset}</code>, queried with{" "}
              <code>neuprint-python</code>. The database holds 176,422 neuron records; {integer(summary.nTypedNeurons)} of
              them carry a cell type, across {integer(summary.nTypes)} types. Neuropil meshes and neuron skeletons for the
              figures and this site were read from Janelia&apos;s public data bucket for the same release.
            </p>
            <p>
              No FlyWire data, no cross-dataset matching field such as <code>flywireType</code>, and no quantity derived
              from the female brain was used as a model input.
            </p>
          </Section>

          <Section id="labels" index={3} title="Labels">
            <p>
              Each neuron&apos;s <code>dimorphism</code> property holds Janelia&apos;s annotation. Annotations were aggregated
              to one label per type in priority order: male-specific or potentially male-specific, then sexually dimorphic
              or potentially sexually dimorphic, otherwise isomorphic. Following Berg et al. (2026), annotations are used
              regardless of confidence.
            </p>
            <Table
              number={next()}
              caption="Label counts per cell type here, against the counts Berg et al. report for types matched between the male and female connectomes."
              head={["Label", "Types in this analysis", "Matched types, Berg et al."]}
              numeric={[1, 2]}
              rows={[
                [<LabelMark key="m" label="male_specific" />, integer(counts.male_specific), "289"],
                [<LabelMark key="d" label="dimorphic" />, integer(counts.dimorphic), "138"],
                [<LabelMark key="i" label="isomorphic" />, integer(counts.isomorphic), "8,069"],
                ["female-specific", "0", "71"],
              ]}
            />
            <p>
              The type set is larger than the published matched set, most likely because it covers every typed neuron
              rather than only cross-matched types. A male dataset cannot contain female-specific types, so the task is
              binary: sex-related ({integer(sexRelated)} types, {percent(sexRelated / summary.nTypes, 1)}) against isomorphic.
            </p>
            <p>
              The <code>fruDsx</code> property, which records <i>fruitless</i> and <i>doublesex</i> expression, was excluded
              from the features. These transcription factors belong to the sex-determination pathway that defines many
              dimorphic neurons, so using them would leak the label. They are used only to cross-check candidates.
            </p>
          </Section>

          <Section id="graph" index={4} title="Cell-type graph">
            <p>
              Neuron-to-neuron synapse counts between typed neurons were fetched with <code>fetch_adjacencies</code> and
              summed into directed type-to-type connections: {integer(summary.nTypePairs)} connected type pairs carrying{" "}
              {integer(summary.typePairSynapses)} synapses. A connection was kept if it supplies at least 1% of the target
              type&apos;s input synapses, and self-loops were removed. The threshold was chosen from graph statistics before
              any model was trained, because the unthresholded graph is too dense for meaningful hop distances.
            </p>
            <p>
              The final graph has {integer(summary.nTypes)} vertices and {integer(summary.nEdges)} edges carrying{" "}
              {integer(summary.edgeSynapses)} synapses.
            </p>
          </Section>

          <Section id="features" index={5} title="Features">
            <p>
              Nine topology features are computed on the graph with igraph (Csardi and Nepusz 2006): in- and out-degree; in-
              and out-strength, the synapses on kept edges; PageRank; betweenness centrality; Leiden community membership
              (Traag et al. 2019), using modularity on the undirected weighted graph with communities of fewer than 25 types
              pooled; hop distance from the nearest sensory type; and hop distance to the nearest descending or motor type.
              The 533 types that cannot reach a motor type receive a value one greater than the largest observed distance.
            </p>
            <p>
              Eighty static features describe each type without reference to topology: its predicted neurotransmitter, and
              the share of its output synapses in each of 79 bilateral neuropils. That makes {c.feature_sets.full.n_features}{" "}
              features in all.
            </p>
            <FeatureTable features={d.attribution.features} number={next()} />
          </Section>

          <Section id="model" index={6} title="Classifier and evaluation">
            <p>
              The classifier is LightGBM (Ke et al. 2017) with hyperparameters fixed before evaluation and never tuned. The
              positive class is weighted by the ratio of isomorphic to sex-related types. Performance is measured by{" "}
              {c.n_folds}-fold stratified cross-validation with seed {c.seed}. Every probability reported is out-of-fold: the
              model that scored a type never saw its label. The primary metric is AUC-PR, whose chance level equals the
              positive rate; accuracy is uninformative at this class balance.
            </p>
            <Table
              number={next()}
              caption="LightGBM settings, fixed before any evaluation."
              head={["Setting", "Value"]}
              numeric={[1]}
              rows={[
                ["Trees", params.n_estimators],
                ["Learning rate", params.learning_rate],
                ["Leaves per tree", params.num_leaves],
                ["Minimum samples per leaf", params.min_child_samples],
                ["Row subsampling", params.subsample],
                ["Column subsampling", params.colsample_bytree],
                ["L2 penalty", params.reg_lambda],
                ["Positive-class weight", (counts.isomorphic / sexRelated).toFixed(2)],
              ]}
            />
            <p>
              Two sensitivity analyses were specified in advance: AUC-PR per class, and cross-validation that keeps each
              developmental hemilineage inside one fold ({integer(c.hemilineage_grouped_cv.n_groups)} groups), since sibling
              types from one hemilineage share wiring.
            </p>
            <Table
              number={next()}
              caption="AUC-PR in each cross-validation fold."
              head={["Fold", "Stratified", "Hemilineages held out"]}
              numeric={[1, 2]}
              rows={d.fold_auc_pr.stratified.map((v, i) => [`Fold ${i + 1}`, v.toFixed(3), d.fold_auc_pr.hemilineage_grouped[i].toFixed(3)])}
            />
          </Section>

          <Section id="performance" index={7} title="Performance">
            <Table
              number={next()}
              caption="Cross-validated performance by feature subset. Subsets specified in advance were fixed before the null-model test; the others were run afterwards to describe where the signal sits and did not change the model."
              head={["Features", "Count", "AUC-PR", "ROC AUC", "Precision in top 100", "Specified"]}
              numeric={[1, 2, 3, 4]}
              wide
              rows={Object.entries(d.feature_sets)
                .sort((a, b) => b[1].auc_pr - a[1].auc_pr)
                .map(([name, s]) => [
                  SET_LABELS[name] ?? name,
                  s.n_features,
                  s.auc_pr.toFixed(3),
                  s.roc_auc.toFixed(3),
                  percent(s.precision_at_100, 0),
                  s.exploratory ? "afterwards" : "in advance",
                ])}
            />
            <Table
              number={next()}
              caption="Each class scored against isomorphic types only, and the hemilineage-grouped sensitivity analysis."
              head={["Evaluation", "Positive types", "AUC-PR", "Chance"]}
              numeric={[1, 2, 3]}
              rows={[
                ["All sex-related types", integer(sexRelated), c.auc_pr.toFixed(3), c.baseline_auc_pr.toFixed(3)],
                [
                  "Male-specific only",
                  integer(c.per_class.male_specific.n_positive),
                  c.per_class.male_specific.auc_pr.toFixed(3),
                  c.per_class.male_specific.baseline_auc_pr.toFixed(3),
                ],
                [
                  "Dimorphic only",
                  integer(c.per_class.dimorphic.n_positive),
                  c.per_class.dimorphic.auc_pr.toFixed(3),
                  c.per_class.dimorphic.baseline_auc_pr.toFixed(3),
                ],
                [
                  "Hemilineages held out",
                  integer(sexRelated),
                  c.hemilineage_grouped_cv.auc_pr.toFixed(3),
                  c.hemilineage_grouped_cv.baseline_auc_pr.toFixed(3),
                ],
              ]}
            />
            <Table
              number={next()}
              caption={`How many of the ${integer(sexRelated)} sex-related types appear among the highest-scoring types.`}
              head={["Highest-scoring", "Types", "Sex-related", "Precision", "Recall"]}
              numeric={[1, 2, 3, 4]}
              rows={d.top_fraction_capture.map((t) => [
                `Top ${percent(t.fraction, 0)}`,
                integer(t.k),
                integer(t.sex_related),
                percent(t.precision),
                percent(t.recall),
              ])}
            />
          </Section>

          <Section id="null-model" index={8} title="Null model">
            <p>
              The analysis plan was written down before any randomized graph was scored. Each of {n.n_trials} null graphs
              is the real graph after 10 × |E| degree-preserving edge swaps (<code>igraph.Graph.rewire</code> on simple
              graphs; Maslov and Sneppen 2002). Every type keeps its exact in-degree and out-degree, and each type&apos;s
              outgoing synapse counts are shuffled across its new outgoing edges, so out-strength is preserved too. All nine
              topology features are recomputed on each null graph and the identical model is retrained with identical folds
              on the real labels. Static features stay fixed because they do not depend on topology.
            </p>
            <p>
              Two tests share the null graphs. The full-model test asks whether real connectivity adds signal beyond the
              degree sequence, neuropil distribution and transmitter. The topology-only test asks whether graph structure
              alone carries signal beyond the degree sequence. Empirical one-sided p-values are (1 + null scores ≥ real) /
              (1 + {n.n_trials}) (Phipson and Smyth 2010), each assessed at a Bonferroni-corrected α = {n.alpha}.
            </p>
            <Table
              number={next()}
              caption={`Real AUC-PR against ${n.n_trials} degree-preserving randomized graphs.`}
              head={["Test", "Real", "Randomized mean ± SD", "Randomized range", "z", "At or above real", "p"]}
              numeric={[1, 2, 3, 4, 5, 6]}
              wide
              rows={nullRows.map(([name, s]) => [
                name,
                s.real.toFixed(3),
                `${s.null_mean.toFixed(3)} ± ${s.null_sd.toFixed(3)}`,
                `${s.null_min.toFixed(3)}–${s.null_max.toFixed(3)}`,
                s.z_score.toFixed(1),
                `${s.n_exceeding} of ${n.n_trials}`,
                s.p_value.toFixed(3),
              ])}
            />
            <p>
              With {n.n_trials} graphs, p = {n.full.p_value.toFixed(3)} is the smallest attainable value, a floor rather
              than a precise estimate.
            </p>
          </Section>

          <Section id="breakdown" index={9} title="Where the signal sits">
            <p>
              The breakdowns below use the out-of-fold probabilities and were computed after the pre-specified analyses.
              AUC-PR within a superclass is reported only when it contains at least ten sex-related and ten isomorphic
              types.
            </p>
            <Table
              number={next()}
              caption="Performance and label counts by superclass."
              head={["Superclass", "Types", "Male-specific", "Dimorphic", "Mean probability", "AUC-PR", "Chance"]}
              numeric={[1, 2, 3, 4, 5, 6]}
              wide
              rows={d.superclasses.map((s) => [
                superclassName(s.superclass),
                integer(s.n_types),
                integer(s.male_specific),
                integer(s.dimorphic),
                s.mean_probability.toFixed(3),
                fixed3(s.auc_pr),
                fixed3(s.baseline_auc_pr),
              ])}
            />
            <Table
              number={next()}
              caption="Leiden communities of the male type graph. Neuropils are those receiving the largest average share of each community's output."
              head={["Community", "Types", "Male-specific", "Dimorphic", "Mean probability", "Main output neuropils"]}
              numeric={[1, 2, 3, 4]}
              wide
              rows={d.communities.communities.map((m) => [
                m.community < 0 ? "Pooled small communities" : `Community ${m.community}`,
                integer(m.n_types),
                integer(m.male_specific),
                integer(m.dimorphic),
                m.mean_probability.toFixed(3),
                m.top_neuropils.map(([r]) => r).join(", "),
              ])}
            />
            <Table
              number={next()}
              caption="Label counts by predicted neurotransmitter."
              head={["Transmitter", "Male-specific", "Dimorphic", "Isomorphic", "Sex-related share"]}
              numeric={[1, 2, 3, 4]}
              rows={Object.entries(d.transmitters).map(([name, t]) => [
                name,
                integer(t.male_specific),
                integer(t.dimorphic),
                integer(t.isomorphic),
                percent((t.male_specific + t.dimorphic) / (t.male_specific + t.dimorphic + t.isomorphic), 1),
              ])}
            />
            <Table
              number={next()}
              caption="Topology features by label: median, with the 25th to 75th percentile in brackets. P(higher) is the chance that a random sex-related type has a higher value than a random isomorphic type; p is from a two-sided Mann–Whitney test."
              head={["Feature", "Male-specific", "Dimorphic", "Isomorphic", "P(higher)", "p"]}
              numeric={[1, 2, 3, 4, 5]}
              wide
              rows={d.topology_by_label.map((row) => [
                featureLabel(row.feature),
                quantile(row, "male_specific"),
                quantile(row, "dimorphic"),
                quantile(row, "isomorphic"),
                percent(row.probability_sex_related_higher, 0),
                smallP(row.mann_whitney_p),
              ])}
            />
            <p>
              Across the {d.neuropil_agreement.n_neuropils} neuropils with at least{" "}
              {integer(d.neuropil_agreement.min_synapses)} synapses, the synapse-weighted mean probability and the share of
              synapses made by annotated sex-related types agree closely (Spearman ρ ={" "}
              {d.neuropil_agreement.spearman_rho.toFixed(2)}, p = {scientific(d.neuropil_agreement.spearman_p, 1)}). This is
              expected rather than independent confirmation, since the probabilities were learned from the same annotations.
            </p>
            <Table
              number={next()}
              caption="The fifteen neuropils with the highest mean classifier probability."
              head={["Neuropil", "Mean probability", "Sex-related share", "Synapses"]}
              numeric={[1, 2, 3]}
              rows={sortedNeuropils.slice(0, 15).map((r) => [
                <>
                  {r.neuropil}
                  <span className="cell-sub">{neuropilName(r.neuropil) ?? "unnamed region"}</span>
                </>,
                r.score.toFixed(3),
                percent(r.annotated_share, 1),
                integer(r.synapses),
              ])}
            />
          </Section>

          <Section id="calibration" index={10} title="Calibration">
            <p>
              Because sex-related types are up-weighted in training, probabilities overstate frequencies and should be read
              as a ranking. The Brier score is {cal.brier.toFixed(4)}, against {cal.brier_prevalence_only.toFixed(4)} for a
              constant prediction at the positive rate.
            </p>
            <Table
              number={next()}
              caption="Types split into ten equal-sized groups by out-of-fold probability."
              head={["Group", "Probability range", "Types", "Mean probability", "Observed sex-related rate"]}
              numeric={[2, 3, 4]}
              rows={cal.bins.map((b, i) => [
                `${i + 1}`,
                `${b.low.toFixed(4)}–${b.high.toFixed(4)}`,
                integer(b.n),
                b.mean_probability.toFixed(4),
                percent(b.observed_rate, 1),
              ])}
            />
          </Section>

          <Section id="candidates" index={11} title="Candidates">
            <p>
              A candidate is a type labeled isomorphic whose out-of-fold probability is in the top 1% of all types. The rule
              was fixed before candidate counts were inspected. The top-1% threshold is a probability of{" "}
              {summary.candidates.threshold.toFixed(3)}, and {summary.candidates.n_candidates} types reach it. Each is
              explained by its largest SHAP contributions in the fold model that scored it, and cross-checked against{" "}
              <i>fru</i>/<i>dsx</i> annotations with a one-sided Fisher exact test: {summary.candidates.fru_dsx_candidates}{" "}
              of {summary.candidates.n_candidates} candidates carry one, against{" "}
              {integer(summary.candidates.fru_dsx_other_isomorphic)} of the{" "}
              {integer(summary.candidates.n_other_isomorphic)} other isomorphic types (p ={" "}
              {summary.candidates.fisher_p_value.toFixed(4)}).
            </p>
            <Table
              number={next()}
              caption="Candidates for further investigation. A high score means a type is wired like known sex-related types; it is not evidence of dimorphism."
              head={["Cell type", "Neurons", "Probability", "fru/dsx annotation", "Sex-related partners", "Largest contributions"]}
              numeric={[1, 2, 4]}
              wide
              rows={candidates.map((x) => [
                <TypeLink key={x.cell_type} name={x.cell_type} />,
                x.n_neurons,
                x.oof_probability.toFixed(3),
                x.fru_dsx.replace("_", " "),
                percent(x.sex_related_partner_share, 0),
                x.top_features,
              ])}
            />
          </Section>

          <Section id="routes" index={12} title="Routes and node removal">
            <p>
              Each connection from type <i>u</i> to type <i>v</i> costs −log(synapses from <i>u</i> to <i>v</i> ÷ total
              output synapses of <i>u</i>). A route&apos;s cost is the negative log of the product of successive output
              shares, and Dijkstra&apos;s algorithm returns the route that keeps the largest share of each type&apos;s output
              at every step. The validation pair was fixed before the search: LPLC2 to TTMn, passing if the Giant Fiber type
              DNp01 lies on the route. The other routes on the site connect well-studied sensory, courtship and motor types.
            </p>
            <Table
              number={next()}
              caption="The strongest route for every pair shown on the site."
              head={["Route", "Path", "Hops", "Product of output shares"]}
              numeric={[2, 3]}
              wide
              rows={routes.map((r) => [
                <>
                  {r.source} to {r.target}
                  <span className="cell-sub">{r.title}</span>
                </>,
                r.route ? r.route.types.join(", ") : "no route",
                r.route ? r.route.hops : "none",
                r.route ? shareProduct(r.route) : "none",
              ])}
            />
            <p>
              For the report, the intermediate type with the highest classifier probability on the LPLC2 to TTMn route,{" "}
              {summary.ablation.removed}, was deleted and routes recomputed. For the site, every intermediate type on every
              route was removed in turn.
            </p>
            <Table
              number={next()}
              caption="The best remaining route after deleting each intermediate type. Products compare the original route with the detour."
              head={["Route", "Removed", "Result", "Hops after", "Product of output shares"]}
              numeric={[3]}
              wide
              rows={ablationRows}
            />
          </Section>

          <Section id="checks" index={13} title="Pre-specified checks">
            <p>Three checks were written down before the results they test. One failed and is reported as it stands.</p>
            <Table
              number={next()}
              caption="Checks fixed in advance, and their outcomes."
              head={["Check", "Criterion", "Result", "Outcome"]}
              wide
              rows={[
                [
                  "Giant Fiber route",
                  "DNp01 lies on the strongest LPLC2 to TTMn route",
                  giantFiber?.route ? giantFiber.route.types.join(", ") : "no route",
                  giantFiber?.route?.types.includes("DNp01") ? "passed" : "failed",
                ],
                [
                  "Null model",
                  `Both tests significant at α = ${n.alpha}`,
                  `p = ${n.full.p_value.toFixed(3)} and ${n.topology_only.p_value.toFixed(3)}`,
                  n.full.significant && n.topology_only.significant ? "passed" : "failed",
                ],
                [
                  "Named types",
                  "At least one of four types named in public announcements ranks in the top 20",
                  d.named_types.map((t) => `${t.cell_type} ${integer(t.rank)}`).join(", "),
                  namedPass ? "passed" : "failed",
                ],
              ]}
            />
          </Section>

          <Section id="limitations" index={14} title="Limitations">
            <ul>
              <li>
                <strong>Label provenance.</strong> No feature comes from the female brain, but the labels themselves come
                from Janelia&apos;s comparison of the male and female connectomes.
              </li>
              <li>
                <strong>Anatomy carries most of the signal.</strong> Neuropil output shares alone reach{" "}
                {d.feature_sets.neuropil_only.auc_pr.toFixed(3)}; real wiring adds a small but consistent increment on top.
              </li>
              <li>
                <strong>Dimorphic types are hard.</strong> Male-specific types reach AUC-PR{" "}
                {c.per_class.male_specific.auc_pr.toFixed(3)}, dimorphic types {c.per_class.dimorphic.auc_pr.toFixed(3)}.
              </li>
              <li>
                <strong>Lineage.</strong> Holding hemilineages out lowers AUC-PR to{" "}
                {c.hemilineage_grouped_cv.auc_pr.toFixed(3)}, so part of the score reflects sibling types.
              </li>
              <li>
                <strong>Scope.</strong> One animal, at cell-type resolution, with chemical synapses only.
              </li>
              <li>
                <strong>Fixed choices.</strong> The 1% edge threshold and the hyperparameters were fixed before evaluation;
                other choices would change the topology features.
              </li>
              <li>
                <strong>Calibration.</strong> Probabilities rank types but overstate frequencies.
              </li>
              <li>
                <strong>Label confidence.</strong> The labels include lower-confidence &ldquo;potentially&rdquo; annotations.
              </li>
              <li>
                <strong>Interpretation.</strong> Every result is correlational or structural. Candidates are not evidence of
                dimorphism, node removal says nothing about behavior, and none of this has been peer reviewed.
              </li>
            </ul>
          </Section>

          <Section id="software" index={15} title="Software and reproduction">
            <Table
              number={next()}
              caption="Software versions used for the reported results."
              head={["Package", "Version"]}
              rows={[
                ["Python", "3.12.12"],
                ["neuprint-python", "0.6.3"],
                ["python-igraph", "1.0.0"],
                ["LightGBM", "4.7.0"],
                ["scikit-learn", "1.9.1"],
                ["SHAP", "0.52.0"],
                ["navis", "1.12.0"],
                ["NumPy, pandas, SciPy", "2.5.3, 3.0.5, 1.18.1"],
              ]}
            />
            <p>
              From a clean checkout, <code>make reproduce</code> reruns the data pipeline, the model, the validations, the
              site export, the unit tests and every check script. Each stage can also be run on its own.
            </p>
            <dl className="make-targets">
              <div>
                <dt>
                  <code>make data</code>
                </dt>
                <dd>Fetch labels and connectivity from neuPrint, build the type graph and compute features.</dd>
              </div>
              <div>
                <dt>
                  <code>make model</code>
                </dt>
                <dd>Train and cross-validate the classifier, and run the Giant Fiber route search.</dd>
              </div>
              <div>
                <dt>
                  <code>make validate</code>
                </dt>
                <dd>Run the null model, candidates, node removal and model diagnostics, and render the hero image.</dd>
              </div>
              <div>
                <dt>
                  <code>make export</code>
                </dt>
                <dd>Write the JSON and geometry files this site reads.</dd>
              </div>
              <div>
                <dt>
                  <code>make checks</code>
                </dt>
                <dd>Compare every exported and reported number against the result files.</dd>
              </div>
            </dl>
          </Section>

          <Section id="references" index={16} title="References">
            <ol className="references">
              <li>
                Ache JM, Polsky J, Alghailani S, et al. (2019). Neural basis for looming size and velocity encoding in the{" "}
                <i>Drosophila</i> giant fiber escape pathway. <i>Current Biology</i> 29(6):1073–1081.e4.{" "}
                <a href="https://doi.org/10.1016/j.cub.2019.01.079">doi:10.1016/j.cub.2019.01.079</a>
              </li>
              <li>
                Berg S, Beckett IR, Costa M, et al. (2026). Sexual dimorphism in the complete <i>Drosophila</i> male central
                nervous system connectome. <i>Cell</i> 189(18):5504–5526.e15.{" "}
                <a href="https://doi.org/10.1016/j.cell.2026.08.015">doi:10.1016/j.cell.2026.08.015</a>
              </li>
              <li>
                Csardi G, Nepusz T (2006). The igraph software package for complex network research.{" "}
                <i>InterJournal Complex Systems</i> 1695.
              </li>
              <li>
                Dorkenwald S, Matsliah A, Sterling AR, et al. (2024). Neuronal wiring diagram of an adult brain.{" "}
                <i>Nature</i> 634:124–138.{" "}
                <a href="https://doi.org/10.1038/s41586-024-07558-y">doi:10.1038/s41586-024-07558-y</a>
              </li>
              <li>
                HHMI Janelia FlyEM. Male CNS connectome, neuPrint dataset male-cns:v1.0.{" "}
                <a href="https://neuprint.janelia.org">neuprint.janelia.org</a>
              </li>
              <li>
                Januszewski M, Jain V (2026). A connectomics milestone: Mapping the complete male fruit fly brain. Google
                Research blog, 3 September 2026.{" "}
                <a href="https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/">
                  research.google
                </a>
              </li>
              <li>
                Ke G, Meng Q, Finley T, et al. (2017). LightGBM: a highly efficient gradient boosting decision tree.{" "}
                <i>Advances in Neural Information Processing Systems</i> 30.
              </li>
              <li>
                Lappalainen JK, Tschopp FD, Prakhya S, et al. (2024). Connectome-constrained networks predict neural activity
                across the fly visual system. <i>Nature</i> 634:1132–1140.{" "}
                <a href="https://doi.org/10.1038/s41586-024-07939-3">doi:10.1038/s41586-024-07939-3</a>
              </li>
              <li>
                Lundberg SM, Lee S-I (2017). A unified approach to interpreting model predictions.{" "}
                <i>Advances in Neural Information Processing Systems</i> 30. arXiv:1705.07874
              </li>
              <li>
                Maslov S, Sneppen K (2002). Specificity and stability in topology of protein networks. <i>Science</i>{" "}
                296(5569):910–913. <a href="https://doi.org/10.1126/science.1065103">doi:10.1126/science.1065103</a>
              </li>
              <li>
                Phipson B, Smyth GK (2010). Permutation p-values should never be zero: calculating exact p-values when
                permutations are randomly drawn. <i>Statistical Applications in Genetics and Molecular Biology</i> 9(1):39.{" "}
                <a href="https://doi.org/10.2202/1544-6115.1585">doi:10.2202/1544-6115.1585</a>
              </li>
              <li>
                Plaza SM, Clements J, Dolafi T, et al. (2022). neuPrint: an open access tool for EM connectomics.{" "}
                <i>Frontiers in Neuroinformatics</i> 16:896292.{" "}
                <a href="https://doi.org/10.3389/fninf.2022.896292">doi:10.3389/fninf.2022.896292</a>
              </li>
              <li>
                Schlegel P, Barnes C, Loesche F, et al. navis: neuron analysis and visualization, version 1.12.0. Zenodo.{" "}
                <a href="https://doi.org/10.5281/zenodo.4699382">doi:10.5281/zenodo.4699382</a>
              </li>
              <li>
                Schlegel P, Yin Y, Bates AS, et al. (2024). Whole-brain annotation and multi-connectome cell typing of{" "}
                <i>Drosophila</i>. <i>Nature</i> 634:139–152.{" "}
                <a href="https://doi.org/10.1038/s41586-024-07686-5">doi:10.1038/s41586-024-07686-5</a>
              </li>
              <li>
                Traag VA, Waltman L, van Eck NJ (2019). From Louvain to Leiden: guaranteeing well-connected communities.{" "}
                <i>Scientific Reports</i> 9:5233.{" "}
                <a href="https://doi.org/10.1038/s41598-019-41695-z">doi:10.1038/s41598-019-41695-z</a>
              </li>
              <li>
                von Reyn CR, Breads P, Peek MY, et al. (2014). A spike-timing mechanism for action selection.{" "}
                <i>Nature Neuroscience</i> 17(7):962–970. <a href="https://doi.org/10.1038/nn.3741">doi:10.1038/nn.3741</a>
              </li>
            </ol>
          </Section>

          <Section id="cite" index={17} title="How to cite">
            <p>If you use this analysis or its code, cite the project and the connectome it analyses.</p>
            <pre className="citation-block">
              <code>{`Sarkar D (2026). Wired Different: predicting sexual dimorphism from male
Drosophila connectome wiring. ${REPO}

Berg S, Beckett IR, Costa M, et al. (2026). Sexual dimorphism in the complete
Drosophila male central nervous system connectome. Cell 189(18):5504-5526.e15.
doi:10.1016/j.cell.2026.08.015`}</code>
            </pre>
            <p>
              The connectome data are released by HHMI Janelia and Google Research under CC-BY 4.0. The code is released under
              the MIT License.
            </p>
          </Section>
        </article>
      </div>
    </div>
  );
}
