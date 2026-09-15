import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ErrorNote, LabelMark, Loading, REPO, REPORT_PDF, Segmented, TypeLink } from "../components/ui.jsx";
import { loadCandidates, loadDiagnostics, loadRoutes, loadSummary } from "../lib/data.js";
import {
  SET_LABELS,
  featureLabel,
  integer,
  isUnassignedRegion,
  neuropilName,
  ordinal,
  outcomeText,
  percent,
  scientific,
  shareProduct,
  superclassName,
} from "../lib/format.js";
import { prefersReducedMotion, useAll } from "../lib/hooks.js";
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

const NB = " ";
const eq = (symbol, value) => (
  <span className="stat">
    <i>{symbol}</i>
    {NB}={NB}
    {value}
  </span>
);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const smallP = (p) => (p < 0.001 ? scientific(p, 1) : p.toFixed(3));
const signed = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(3)}`;

const GROUP_LABELS = { neuropil: "Neuropil", topology: "Topology", transmitter: "Transmitter" };
const TRANSMITTERS = { gaba: "GABA" };
const UNASSIGNED = { CentralBrain: "central brain", Optic: "optic lobe", VNC: "nerve cord", CV: "cervical connective" };
const OUTCOMES = {
  "rerouted, longer": "Longer route",
  "rerouted, same length": "Same number of hops",
  "rerouted, fewer hops": "Fewer hops",
  disconnected: "No route remains",
  unchanged: "Unchanged",
};

function regionName(roi) {
  if (isUnassignedRegion(roi)) return `unassigned ${UNASSIGNED[roi.split("-")[0]] ?? "region"}`;
  return roi;
}

function featureName(name) {
  const roi = name.startsWith("out_frac_") ? name.slice("out_frac_".length) : null;
  if (roi && isUnassignedRegion(roi)) return `Output share in ${regionName(roi)}`;
  if (name === "hops_to_motor") return "Hops to descending or motor types";
  return cap(featureLabel(name));
}

function regionDescription(roi) {
  if (isUnassignedRegion(roi)) return `unassigned synapses, ${UNASSIGNED[roi.split("-")[0]] ?? "other"}`;
  return neuropilName(roi) ?? "not a standard neuropil";
}

/** Readable form of an annotation summary such as "fru_low (2/2 neurons)". */
function fruDsxText(value) {
  const match = value.match(/^(\S+) \((\d+)\/(\d+) neurons\)$/);
  if (!match) return value;
  const parts = match[1].split("_");
  const genes = parts.filter((p) => p === "fru" || p === "dsx");
  const level = parts.filter((p) => p !== "fru" && p !== "dsx").join(" ");
  return (
    <>
      {level ? `${cap(level)} ` : "Any "}
      {genes.map((g, i) => (
        <span key={g}>
          {i > 0 && "/"}
          <i>{g}</i>
        </span>
      ))}{" "}
      expression
      <span className="cell-sub">
        {match[2]} of {match[3]} neurons
      </span>
    </>
  );
}

function RoutePath({ types }) {
  return (
    <span className="route-path">
      {types.map((t, i) => (
        <span key={t}>
          {i > 0 && " → "}
          <span className="route-step">{t}</span>
        </span>
      ))}
    </span>
  );
}

function Missing({ children = "not computed" }) {
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="visually-hidden">{children}</span>
    </>
  );
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  section.querySelector("h2")?.focus({ preventScroll: true });
}

function useOverflow() {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState({ x: false, y: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const check = () => {
      const x = element.scrollWidth > element.clientWidth + 1;
      const y = element.scrollHeight > element.clientHeight + 1;
      setOverflow((o) => (o.x === x && o.y === y ? o : { x, y }));
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return [ref, overflow];
}

function Table({ number, title, note, head, rows, numeric = [], size = "", controls, scroll = false, rowClass }) {
  const captionId = `${useId()}-caption`;
  const [wrap, overflow] = useOverflow();
  const focusable = overflow.x || overflow.y ? { tabIndex: 0, role: "region", "aria-labelledby": captionId } : {};
  return (
    <div className={size ? `table-block table-${size}` : "table-block"}>
      <p className="table-caption" id={captionId}>
        <span className="table-number">Table {number}</span>
        <span className="table-title">{title}.</span>
        {note && <> {note}</>}
      </p>
      {controls && <div className="table-controls">{controls}</div>}
      <div
        ref={wrap}
        className={scroll ? "table-wrap table-scroll" : "table-wrap"}
        data-overflow-x={overflow.x ? "true" : undefined}
        {...focusable}
      >
        <table className="data-table" aria-labelledby={captionId}>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col" className={numeric.includes(i) ? "num-col" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={rowClass?.(r)}>
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
    </div>
  );
}

function Section({ id, index, title, children }) {
  return (
    <section className="methods-section" id={id} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="methods-heading" tabIndex={-1}>
        <span className="methods-heading-number">{index}</span>
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

function ContentsList({ active, onSelect }) {
  return (
    <ol>
      {SECTIONS.map(([id, title], i) => (
        <li key={id}>
          <button
            type="button"
            className={active === id ? "on" : ""}
            aria-current={active === id ? "location" : undefined}
            onClick={() => {
              onSelect?.();
              scrollToSection(id);
            }}
          >
            <span className="toc-number">{i + 1}</span>
            <span>{title}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Contents({ active }) {
  const details = useRef(null);
  const index = Math.max(
    0,
    SECTIONS.findIndex(([id]) => id === active),
  );
  return (
    <>
      <nav className="methods-toc" aria-label="Contents">
        <p className="methods-toc-title">Contents</p>
        <ContentsList active={active} />
      </nav>
      <nav className="methods-toc-compact" aria-label="Contents">
        <details ref={details}>
          <summary>
            <span className="toc-compact-label">Contents</span>
            <span className="toc-compact-current">
              <span className="toc-number">{index + 1}</span>
              {SECTIONS[index][1]}
            </span>
          </summary>
          <ContentsList
            active={active}
            onSelect={() => {
              if (details.current) details.current.open = false;
            }}
          />
        </details>
      </nav>
    </>
  );
}

function FeatureTable({ features, number }) {
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState("importance");
  const count = (g) => features.filter((f) => f.group === g).length;
  const rows = useMemo(() => {
    const kept = features.filter((f) => group === "all" || f.group === group);
    if (sort === "name") return [...kept].sort((a, b) => featureName(a.feature).localeCompare(featureName(b.feature)));
    return [...kept].sort((a, b) => b.mean_abs_shap - a.mean_abs_shap);
  }, [features, group, sort]);
  return (
    <Table
      number={number}
      size="wide"
      scroll
      title="Model features and their attributions"
      note="Mean absolute SHAP value over all types, and mean signed SHAP value within each class, in log-odds. Positive values push a type toward sex-related. Codes beneath each name are the column names in the pipeline."
      controls={
        <>
          <div className="table-control">
            <span className="table-control-label" aria-hidden="true">
              Show
            </span>
            <Segmented
              label="Show feature group"
              value={group}
              onChange={setGroup}
              options={[
                { value: "all", label: `All ${features.length}` },
                { value: "neuropil", label: `Neuropil ${count("neuropil")}` },
                { value: "topology", label: `Topology ${count("topology")}` },
                { value: "transmitter", label: `Transmitter ${count("transmitter")}` },
              ]}
            />
          </div>
          <div className="table-control">
            <span className="table-control-label" aria-hidden="true">
              Sort
            </span>
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
        </>
      }
      head={["Feature", "Group", "Mean |SHAP|", "Mean SHAP, sex-related", "Mean SHAP, isomorphic"]}
      numeric={[2, 3, 4]}
      rows={rows.map((f) => [
        <>
          {featureName(f.feature)}
          <span className="cell-sub">{f.feature}</span>
        </>,
        GROUP_LABELS[f.group] ?? f.group,
        f.mean_abs_shap.toFixed(3),
        signed(f.mean_shap_sex_related),
        signed(f.mean_shap_isomorphic),
      ])}
    />
  );
}

export default function Methods() {
  const data = useAll([loadSummary, loadDiagnostics, loadRoutes, loadCandidates]);
  const [active, setActive] = useState(SECTIONS[0][0]);

  useEffect(() => {
    if (!data.value) return undefined;
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = SECTIONS.find(([id]) => visible.has(id));
        if (first) setActive(first[0]);
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
  const nullP = n.full.p_value.toFixed(3);
  const topologyP = n.topology_only.p_value.toFixed(3);
  const quantile = (row, label) => {
    const q = row.quantiles[label];
    const f = row.feature === "pagerank" ? (v) => (v * 1e5).toFixed(1) : integer;
    return (
      <>
        {f(q[2])}
        <span className="cell-sub">
          {f(q[1])}–{f(q[3])}
        </span>
      </>
    );
  };
  const sortedNeuropils = [...d.neuropil_agreement.neuropils].sort((a, b) => b.score - a.score);
  const namedPass = d.named_types.some((t) => t.rank <= 20);
  const giantFiber = routes.find((r) => r.source === "LPLC2" && r.target === "TTMn");
  const ablations = routes.flatMap((r) =>
    Object.entries(r.ablations).map(([removed, a], i, all) => ({ r, removed, a, first: i === 0, last: i === all.length - 1 })),
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
        <p className="methods-byline">
          Dhruvin Sarkar, September 14, 2026. An independent analysis of public data, not peer reviewed.
        </p>
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
              A gradient-boosted classifier trained only on features of the male connectome ranks most of the{" "}
              {integer(sexRelated)} cell types annotated as male-specific or dimorphic (together, sex-related) near the top
              of all {integer(summary.nTypes)} types: out-of-fold AUC-PR is {c.auc_pr.toFixed(3)}, against a chance level
              of {c.baseline_auc_pr.toFixed(3)}. On {n.n_trials} degree-preserving randomized graphs the same model never
              matched that score ({eq("p", nullP)}). With topology features alone the real graph scores{" "}
              {n.topology_only.real.toFixed(3)} against {n.topology_only.null_mean.toFixed(3)} for randomized wiring (
              {eq("p", topologyP)}).
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
                <dt>AUC-PR, hemilineage-grouped folds</dt>
                <dd>{c.hemilineage_grouped_cv.auc_pr.toFixed(3)}</dd>
              </div>
              <div>
                <dt>AUC-PR, topology features only</dt>
                <dd>{c.feature_sets.topology_only.auc_pr.toFixed(3)}</dd>
              </div>
              <div>
                <dt>{nullP === topologyP ? "Null-model p, each of two tests" : "Null-model p, full and topology-only"}</dt>
                <dd>{nullP === topologyP ? nullP : `${nullP}, ${topologyP}`}</dd>
              </div>
            </dl>

            <h3 className="methods-subheading">Terms used on this page</h3>
            <dl className="glossary">
              <div>
                <dt>Male-specific, dimorphic, isomorphic</dt>
                <dd>
                  Janelia&apos;s annotation of each cell type: found only in males; found in both sexes but different between
                  them; or the same in both sexes.
                </dd>
              </div>
              <div>
                <dt>Sex-related</dt>
                <dd>This analysis groups male-specific and dimorphic types together as sex-related.</dd>
              </div>
              <div>
                <dt>Out-of-fold probability</dt>
                <dd>
                  A type&apos;s score from the one of the {c.n_folds} cross-validation models that did not see its label during
                  training.
                </dd>
              </div>
              <div>
                <dt>AUC-PR</dt>
                <dd>
                  Area under the precision–recall curve. It is 1 for a ranking that puts every sex-related type first, and
                  equals the share of sex-related types, {c.baseline_auc_pr.toFixed(3)}, for a random ranking.
                </dd>
              </div>
              <div>
                <dt>ROC AUC</dt>
                <dd>The chance that a random sex-related type scores above a random isomorphic type; 0.5 is chance.</dd>
              </div>
              <div>
                <dt>SHAP value</dt>
                <dd>How far one feature moves a type&apos;s score up or down, in log-odds (Lundberg and Lee 2017).</dd>
              </div>
              <div>
                <dt>Degree-preserving randomized graph</dt>
                <dd>
                  The real graph with its connections shuffled so that every type keeps its number of input and output
                  partners, while who connects to whom is scrambled.
                </dd>
              </div>
              <div>
                <dt>Hemilineage</dt>
                <dd>
                  Neurons born from the same neural stem cell and sharing a developmental program. Sibling types from one
                  hemilineage often share wiring.
                </dd>
              </div>
            </dl>
          </Section>

          <Section id="data" index={2} title="Data">
            <p>
              All data come from neuPrint (Plaza et al. 2022), dataset <code>{summary.dataset}</code>, queried with{" "}
              <code>neuprint-python</code>. The neuPrint dataset holds 176,422 neuron records; {integer(summary.nTypedNeurons)}{" "}
              of them carry a cell type, across {integer(summary.nTypes)} types. Neuropil meshes and neuron skeletons for the
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
              title="Label counts"
              note="Cell types per label in this analysis, beside the counts Berg et al. (2026) report for types matched between the male and female connectomes."
              head={["Label", "Types in this analysis", "Matched types, Berg et al. (2026)"]}
              numeric={[1, 2]}
              rows={[
                [
                  <span key="m" className="label-mark">
                    <LabelMark label="male_specific" text={false} />
                    Male-specific
                  </span>,
                  integer(counts.male_specific),
                  "289",
                ],
                [
                  <span key="d" className="label-mark">
                    <LabelMark label="dimorphic" text={false} />
                    Dimorphic
                  </span>,
                  integer(counts.dimorphic),
                  "138",
                ],
                [
                  <span key="i" className="label-mark">
                    <LabelMark label="isomorphic" text={false} />
                    Isomorphic
                  </span>,
                  integer(counts.isomorphic),
                  "8,069",
                ],
                [
                  <span key="f" className="label-mark">
                    <span className="dot dot-empty" aria-hidden="true" />
                    Female-specific
                  </span>,
                  "0",
                  "71",
                ],
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
              Nine topology features are computed on the graph with igraph (Csardi and Nepusz 2006): in-degree and
              out-degree, the number of partner types; in-strength and out-strength, the synapses on kept edges; PageRank;
              betweenness centrality; Leiden community membership (Traag et al. 2019), using modularity on the undirected
              weighted graph, with communities of fewer than 25 types pooled; hop distance from the nearest sensory type; and
              hop distance to the nearest descending or motor type. The 533 types that cannot reach a descending or motor
              type receive a value one greater than the largest observed distance.
            </p>
            <p>
              Eighty static features describe each type without reference to the graph: its predicted neurotransmitter, and
              the share of its output synapses in each of 79 regions, which are 75 neuropils with left and right pooled and 4
              unassigned regions. That makes {c.feature_sets.full.n_features} features in all.
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
              size="narrow"
              title="LightGBM settings"
              note="Fixed before any evaluation."
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
              Two sensitivity analyses were specified in advance: AUC-PR per class, and cross-validation with
              hemilineage-grouped folds, which keep each developmental hemilineage inside one fold (
              {integer(c.hemilineage_grouped_cv.n_groups)} groups), since sibling types from one hemilineage share wiring.
            </p>
            <Table
              number={next()}
              size="narrow"
              title="AUC-PR in each cross-validation fold"
              note={`Pooled over all folds, out-of-fold AUC-PR is ${c.auc_pr.toFixed(3)} with stratified folds and ${c.hemilineage_grouped_cv.auc_pr.toFixed(3)} with hemilineage-grouped folds.`}
              head={["Fold", "Stratified", "Hemilineage-grouped"]}
              numeric={[1, 2]}
              rows={d.fold_auc_pr.stratified.map((v, i) => [
                `Fold ${i + 1}`,
                v.toFixed(3),
                d.fold_auc_pr.hemilineage_grouped[i].toFixed(3),
              ])}
            />
          </Section>

          <Section id="performance" index={7} title="Performance">
            <p>
              Every value in this section is out-of-fold. Chance AUC-PR is {c.baseline_auc_pr.toFixed(3)} for all sex-related types
              together and lower for each class alone, because each class is rarer. Precision is the share of sex-related
              types among the highest-scoring types; recall is the share of all sex-related types that those types include.
            </p>
            <Table
              number={next()}
              size="wide"
              title="Performance by feature subset"
              note="Subsets specified in advance were fixed before the null-model test. The others were run afterwards to describe where the signal sits and did not change the model."
              head={["Features", "Count", "AUC-PR", "ROC AUC", "Precision in top 100", "Specified"]}
              numeric={[1, 2, 3, 4]}
              rows={Object.entries(d.feature_sets)
                .sort((a, b) => b[1].auc_pr - a[1].auc_pr)
                .map(([name, s]) => [
                  SET_LABELS[name] ?? name,
                  s.n_features,
                  s.auc_pr.toFixed(3),
                  s.roc_auc.toFixed(3),
                  percent(s.precision_at_100, 0),
                  s.exploratory ? "Afterwards" : "In advance",
                ])}
            />
            <Table
              number={next()}
              title="Performance by class"
              note="Each class is scored against isomorphic types only; the last row repeats the full evaluation with hemilineage-grouped folds."
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
                  "Hemilineage-grouped folds",
                  integer(sexRelated),
                  c.hemilineage_grouped_cv.auc_pr.toFixed(3),
                  c.hemilineage_grouped_cv.baseline_auc_pr.toFixed(3),
                ],
              ]}
            />
            <Table
              number={next()}
              title="Sex-related types among the highest scores"
              note={`How many of the ${integer(sexRelated)} sex-related types appear in each top fraction of all ${integer(summary.nTypes)} types.`}
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
              is the real graph after 10{NB}×{NB}|<i>E</i>| degree-preserving edge-swap attempts, where |<i>E</i>| is the
              number of edges (<code>igraph.Graph.rewire</code> on simple graphs; Maslov and Sneppen 2002). Every type keeps
              its exact in-degree and out-degree, and each type&apos;s outgoing synapse counts are shuffled across its new
              outgoing edges, so out-strength is preserved too. All nine topology features are recomputed on each null graph
              and the identical model is retrained with identical folds on the real labels. Static features stay fixed
              because they do not depend on topology.
            </p>
            <p>
              Two tests share the null graphs. The full-model test asks whether real connectivity adds signal beyond the
              degree sequence, neuropil distribution and transmitter. The topology-only test asks whether graph structure
              alone carries signal beyond the degree sequence. Empirical one-sided <i>p</i>-values follow Phipson and Smyth (2010):
            </p>
            <p className="methods-equation">
              <i>p</i> = (1 + number of null scores ≥ real score) / (1 + {n.n_trials})
            </p>
            <p>Each is assessed at a Bonferroni-corrected {eq("α", n.alpha)}.</p>
            <Table
              number={next()}
              size="wide"
              title="Real AUC-PR against randomized graphs"
              note={
                <>
                  {n.n_trials} degree-preserving randomized graphs; <i>z</i> is the distance of the real score from the
                  randomized mean in standard deviations.
                </>
              }
              head={[
                "Test",
                "Real graph",
                "Randomized mean ± SD",
                "Randomized range",
                <i key="z">z</i>,
                "At or above real",
                <i key="p">p</i>,
              ]}
              numeric={[1, 2, 3, 4, 5, 6]}
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
              With {n.n_trials} graphs, {eq("p", nullP)} is the smallest attainable value, a floor rather than a precise
              estimate.
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
              size="wide"
              title="Performance and label counts by superclass"
              note="A dash marks superclasses too small for AUC-PR to be reported."
              head={["Superclass", "Types", "Male-specific", "Dimorphic", "Mean probability", "AUC-PR", "Chance"]}
              numeric={[1, 2, 3, 4, 5, 6]}
              rows={d.superclasses.map((s) => [
                cap(superclassName(s.superclass)),
                integer(s.n_types),
                integer(s.male_specific),
                integer(s.dimorphic),
                s.mean_probability.toFixed(3),
                s.auc_pr == null ? <Missing /> : s.auc_pr.toFixed(3),
                s.baseline_auc_pr == null ? <Missing /> : s.baseline_auc_pr.toFixed(3),
              ])}
            />
            <Table
              number={next()}
              size="wide"
              title="Leiden communities of the male type graph"
              note="Main output neuropils are the three receiving the largest average share of each community's output synapses."
              head={["Community", "Types", "Male-specific", "Dimorphic", "Mean probability", "Main output neuropils"]}
              numeric={[1, 2, 3, 4]}
              rows={d.communities.communities.map((m) => [
                m.community < 0 ? "Pooled small communities" : `Community ${m.community}`,
                integer(m.n_types),
                integer(m.male_specific),
                integer(m.dimorphic),
                m.mean_probability.toFixed(3),
                m.top_neuropils.map(([r]) => regionName(r)).join(", "),
              ])}
            />
            <Table
              number={next()}
              title="Label counts by predicted neurotransmitter"
              head={["Transmitter", "Types", "Male-specific", "Dimorphic", "Sex-related share"]}
              numeric={[1, 2, 3, 4]}
              rows={Object.entries(d.transmitters).map(([name, t]) => {
                const total = t.male_specific + t.dimorphic + t.isomorphic;
                return [
                  TRANSMITTERS[name] ?? cap(name),
                  integer(total),
                  integer(t.male_specific),
                  integer(t.dimorphic),
                  percent((t.male_specific + t.dimorphic) / total, 1),
                ];
              })}
            />
            <Table
              number={next()}
              size="wide"
              title="Topology features by label"
              note={
                <>
                  Median, with the 25th to 75th percentile beneath. P(higher) is the probability that a random sex-related
                  type has a higher value than a random isomorphic type, where 0.50 means no difference; <i>p</i> is from a
                  two-sided Mann–Whitney <i>U</i> test.
                </>
              }
              head={["Feature", "Male-specific", "Dimorphic", "Isomorphic", "P(higher)", <i key="p">p</i>]}
              numeric={[1, 2, 3, 4, 5]}
              rows={d.topology_by_label.map((row) => [
                <>
                  {featureName(row.feature)}
                  {row.feature === "pagerank" && <span className="cell-sub">values × 10⁻⁵</span>}
                </>,
                quantile(row, "male_specific"),
                quantile(row, "dimorphic"),
                quantile(row, "isomorphic"),
                row.probability_sex_related_higher.toFixed(2),
                smallP(row.mann_whitney_p),
              ])}
            />
            <p>
              Across the {d.neuropil_agreement.n_neuropils} neuropils with at least{" "}
              {integer(d.neuropil_agreement.min_synapses)} synapses, the synapse-weighted mean probability and the share of
              synapses made by annotated sex-related types agree closely (Spearman{" "}
              {eq("ρ", d.neuropil_agreement.spearman_rho.toFixed(2))}, {eq("p", scientific(d.neuropil_agreement.spearman_p, 1))}).
              This is expected rather than independent confirmation, since the probabilities were learned from the same
              annotations.
            </p>
            <Table
              number={next()}
              title="Neuropils with the highest mean classifier probability"
              note="The fifteen highest, with left and right counted separately. Mean probability is weighted by synapses."
              head={["Neuropil", "Mean probability", "Sex-related share", "Synapses"]}
              numeric={[1, 2, 3]}
              rows={sortedNeuropils.slice(0, 15).map((r) => [
                <>
                  {r.neuropil}
                  <span className="cell-sub">{regionDescription(r.neuropil)}</span>
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
              as a ranking. The Brier score, the mean squared difference between probability and outcome, is{" "}
              {cal.brier.toFixed(4)}, against {cal.brier_prevalence_only.toFixed(4)} for a constant prediction at the
              positive rate; lower is better.
            </p>
            <Table
              number={next()}
              title="Calibration by decile"
              note="Types split into ten equal-sized groups by out-of-fold probability, lowest first."
              head={["Decile", "Probability range", "Types", "Mean probability", "Observed sex-related rate"]}
              numeric={[1, 2, 3, 4]}
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
              A candidate is a type annotated isomorphic whose out-of-fold probability is in the top 1% of all types. The
              rule was fixed before candidate counts were inspected. The top-1% threshold is a probability of{" "}
              {summary.candidates.threshold.toFixed(3)}, and {summary.candidates.n_candidates} types reach it. Each is
              explained by its largest SHAP contributions in the fold model that scored it, and cross-checked against{" "}
              <i>fru</i>/<i>dsx</i> annotations with a one-sided Fisher exact test: {summary.candidates.fru_dsx_candidates}{" "}
              of {summary.candidates.n_candidates} candidates carry one, against{" "}
              {integer(summary.candidates.fru_dsx_other_isomorphic)} of the{" "}
              {integer(summary.candidates.n_other_isomorphic)} other isomorphic types (
              {eq("p", summary.candidates.fisher_p_value.toFixed(4))}).
            </p>
            <Table
              number={next()}
              size="wide"
              title="Candidates for further investigation"
              note="A high score means a type is wired like known sex-related types; it is not evidence of dimorphism. Sex-related partners is the share of a type's strong input and output partners that are sex-related."
              head={[
                "Cell type",
                "Neurons",
                "Probability",
                <span key="fd">
                  <i>fru</i>/<i>dsx</i> annotation
                </span>,
                "Sex-related partners",
                "Largest contributions",
              ]}
              numeric={[1, 2, 4]}
              rows={candidates.map((x) => [
                <TypeLink key={x.cell_type} name={x.cell_type} />,
                x.n_neurons,
                x.oof_probability.toFixed(3),
                x.fru_dsx === "none" ? "None" : fruDsxText(x.fru_dsx),
                percent(x.sex_related_partner_share, 0),
                <ul key="c" className="cell-list">
                  {x.top_features.split("; ").map((reason) => (
                    <li key={reason}>{cap(reason)}</li>
                  ))}
                </ul>,
              ])}
            />
          </Section>

          <Section id="routes" index={12} title="Routes and node removal">
            <p>
              Each connection from type <i>u</i> to type <i>v</i> costs −log(synapses from <i>u</i> to <i>v</i> ÷ total
              output synapses of <i>u</i>). A route&apos;s cost is therefore the negative log of the product of successive
              output shares, and Dijkstra&apos;s algorithm returns the route whose product of output shares is largest. The
              validation pair was fixed before the search: LPLC2 to TTMn, passing if the Giant Fiber type DNp01 lies on the
              route. The other routes on the site connect well-studied sensory, courtship and motor types.
            </p>
            <Table
              number={next()}
              size="wide"
              title="The strongest route for every pair shown on the site"
              head={["Route", "Path", "Hops", "Product of output shares"]}
              numeric={[2, 3]}
              rows={routes.map((r) => [
                <>
                  {r.source} to {r.target}
                  <span className="cell-sub">{r.title}</span>
                </>,
                r.route ? <RoutePath types={r.route.types} /> : "No route",
                r.route ? r.route.hops : <Missing>none</Missing>,
                r.route ? shareProduct(r.route) : <Missing>none</Missing>,
              ])}
            />
            <p>
              For the report, the intermediate type with the highest classifier probability on the LPLC2 to TTMn route,{" "}
              {summary.ablation.removed}, was deleted and routes recomputed. For the site, every intermediate type on every
              route was removed in turn.
            </p>
            <Table
              number={next()}
              size="wide"
              title="The best remaining route after deleting each intermediate type"
              note="Hops and products describe the detour; the original routes are in the table above. Times smaller compares the detour's product of output shares with the original route's."
              head={["Route", "Removed type", "Result", "Hops", "Product of output shares", "Times smaller"]}
              numeric={[3, 4, 5]}
              rowClass={(i) => (ablations[i].last ? "group-end" : "group-inner")}
              rows={ablations.map(({ r, removed, a, first }) => [
                first ? (
                  `${r.source} to ${r.target}`
                ) : (
                  <span className="visually-hidden">
                    {r.source} to {r.target}
                  </span>
                ),
                <TypeLink key={removed} name={removed} />,
                OUTCOMES[a.outcome] ?? cap(outcomeText(a.outcome)),
                a.route ? a.route.hops : <Missing>none</Missing>,
                a.route ? shareProduct(a.route) : <Missing>no route</Missing>,
                a.route && r.route ? (
                  `${(() => {
                    const ratio = Math.exp(a.route.cost - r.route.cost);
                    return ratio < 10 ? ratio.toFixed(1) : integer(ratio);
                  })()}×`
                ) : (
                  <Missing>no route</Missing>
                ),
              ])}
            />
          </Section>

          <Section id="checks" index={13} title="Pre-specified checks">
            <p>Three checks were written down before the results they test. One failed and is reported as it stands.</p>
            <Table
              number={next()}
              size="wide"
              title="Checks fixed in advance, and their outcomes"
              head={["Check", "Criterion", "Result", "Outcome"]}
              rows={[
                [
                  "Giant Fiber route",
                  "DNp01 lies on the strongest LPLC2 to TTMn route",
                  giantFiber?.route ? <RoutePath types={giantFiber.route.types} /> : "No route",
                  giantFiber?.route?.types.includes("DNp01") ? "Passed" : "Failed",
                ],
                [
                  "Null model",
                  <>Both tests significant at {eq("α", n.alpha)}</>,
                  <>
                    {eq("p", nullP)} for all features and {topologyP} for topology only
                  </>,
                  n.full.significant && n.topology_only.significant ? "Passed" : "Failed",
                ],
                [
                  "Named types",
                  "At least one of four types named in public announcements ranks in the top 20",
                  `Ranks: ${d.named_types.map((t) => `${t.cell_type} ${ordinal(t.rank)}`).join(", ")}`,
                  namedPass ? "Passed" : "Failed",
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
                <strong>Anatomy carries most of the signal.</strong> Neuropil output shares alone reach AUC-PR{" "}
                {d.feature_sets.neuropil_only.auc_pr.toFixed(3)}. Real connectivity adds a small increment: the full model
                scores {n.full.real.toFixed(3)} on the real graph against {n.full.null_mean.toFixed(3)} ±{" "}
                {n.full.null_sd.toFixed(3)} on randomized graphs.
              </li>
              <li>
                <strong>Dimorphic types are hard.</strong> Male-specific types reach AUC-PR{" "}
                {c.per_class.male_specific.auc_pr.toFixed(3)}, dimorphic types {c.per_class.dimorphic.auc_pr.toFixed(3)}.
              </li>
              <li>
                <strong>Lineage.</strong> Hemilineage-grouped folds lower AUC-PR to{" "}
                {c.hemilineage_grouped_cv.auc_pr.toFixed(3)}, so part of the score reflects sibling types.
              </li>
              <li>
                <strong>Scope.</strong> One animal, at cell-type resolution, with chemical synapses only.
              </li>
              <li>
                <strong>Fixed choices.</strong> The 1% edge threshold and the hyperparameters were fixed before evaluation;
                other choices would change the results.
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
              size="narrow"
              title="Software versions"
              note="Versions used for the reported results."
              head={["Package", "Version"]}
              numeric={[1]}
              rows={[
                ["Python", "3.12"],
                ["neuprint-python", "0.6.3"],
                ["python-igraph", "1.0.0"],
                ["LightGBM", "4.7.0"],
                ["scikit-learn", "1.9.1"],
                ["SHAP", "0.52.0"],
                ["navis", "1.12.0"],
                ["NumPy", "2.5.3"],
                ["pandas", "3.0.5"],
                ["SciPy", "1.18.1"],
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
            <ul className="references">
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
                Research blog, September 3, 2026.{" "}
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
                <i>Advances in Neural Information Processing Systems</i> 30.{" "}
                <a href="https://arxiv.org/abs/1705.07874">arXiv:1705.07874</a>
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
            </ul>
          </Section>

          <Section id="cite" index={17} title="How to cite">
            <p>If you use this analysis or its code, cite the project and the connectome it analyzes.</p>
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
