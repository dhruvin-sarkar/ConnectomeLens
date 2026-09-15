import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorNote, LabelMark, Loading, Segmented, TypeLink } from "../components/ui.jsx";
import BrainStain from "../figures/BrainStain.jsx";
import { loadCandidates, loadExplanations, loadNeuropils, loadTypes, loadWiring, percentile } from "../lib/data.js";
import {
  LABELS,
  SEX_RELATED,
  featureLabel,
  fruDsxText,
  integer,
  neuropilName,
  ordinal,
  percent,
  probability,
  scientific,
  superclassName,
} from "../lib/format.js";
import { prefersReducedMotion, useAll, useSize } from "../lib/hooks.js";
import { href, replaceParams } from "../lib/route.js";

const ROW = 46;
const NO_ROUTE_HOPS = 7;

const CHANNEL_TEXT = {
  prediction: "Brighter magenta: higher mean classifier probability of the types making synapses there.",
  annotation: "Brighter green: a larger share of synapses made by types annotated dimorphic or male-specific.",
  merge: "Magenta is the classifier, green the annotation; white where both are high.",
};

const LANDMARKS = [
  ["DNp01", "The Giant Fiber, which drives the escape jump"],
  ["pIP10", "Descending neuron that drives courtship song"],
  ["AOTU008", "Shown in Google Research's announcement as differing between the sexes"],
];

function TypeIndex({ types, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [superclass, setSuperclass] = useState("");
  const [sort, setSort] = useState("rank");
  const scroller = useRef(null);
  const { height } = useSize(scroller);
  const [scrollTop, setScrollTop] = useState(0);

  const superclasses = useMemo(() => {
    const counts = new Map();
    for (const t of types.list) counts.set(t.s, (counts.get(t.s) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [types]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    types.list.forEach((t, i) => {
      if (q && !t.t.toLowerCase().includes(q)) return;
      if (filter === "sex_related" && !SEX_RELATED.has(t.l)) return;
      if (filter === "isomorphic" && t.l !== "isomorphic") return;
      if (superclass && t.s !== superclass) return;
      out.push(i);
    });
    const name = (i) => types.list[i].t;
    if (sort === "name") out.sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
    if (q) out.sort((a, b) => Number(!name(a).toLowerCase().startsWith(q)) - Number(!name(b).toLowerCase().startsWith(q)));
    return out;
  }, [types, query, filter, superclass, sort]);

  useEffect(() => {
    const element = scroller.current;
    const position = items.indexOf(selected);
    if (!element || position < 0) return;
    const y = position * ROW;
    if (y < element.scrollTop || y > element.scrollTop + element.clientHeight - ROW) {
      element.scrollTop = Math.max(0, y - element.clientHeight / 2 + ROW / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const onKeyDown = (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[event.key];
    if (!step || items.length === 0) return;
    event.preventDefault();
    const position = items.indexOf(selected);
    const next = position < 0 ? 0 : Math.max(0, Math.min(items.length - 1, position + step));
    onSelect(items[next]);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 6);
  const last = Math.min(items.length, Math.ceil((scrollTop + (height || 800)) / ROW) + 6);

  return (
    <section className="atlas-index" aria-labelledby="atlas-title">
      <div className="atlas-index-head">
        <h1 id="atlas-title" className="tool-title">
          Atlas
        </h1>
        <p className="tool-lede">
          Every cell type in the male central nervous system, ranked by the classifier&apos;s out-of-fold probability.
        </p>
        <label className="visually-hidden" htmlFor="atlas-search">
          Search cell types
        </label>
        <input
          id="atlas-search"
          type="search"
          placeholder="Search cell types, e.g. pC1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented
          label="Annotation"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "sex_related", label: "Sex-related" },
            { value: "isomorphic", label: "Isomorphic" },
          ]}
        />
        <div className="atlas-selects">
          <label>
            <span className="visually-hidden">Superclass</span>
            <select value={superclass} onChange={(e) => setSuperclass(e.target.value)}>
              <option value="">All superclasses</option>
              {superclasses.map(([s, n]) => (
                <option key={s} value={s}>
                  {superclassName(s)} ({integer(n)})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="rank">By probability</option>
              <option value="name">By name</option>
            </select>
          </label>
        </div>
        <p className="atlas-count" aria-live="polite">
          {items.length === types.list.length
            ? `${integer(items.length)} types`
            : `${integer(items.length)} of ${integer(types.list.length)} types`}
        </p>
      </div>
      <div
        ref={scroller}
        className="type-list"
        role="listbox"
        tabIndex={0}
        aria-label="Cell types"
        aria-activedescendant={selected != null && items.includes(selected) ? `type-option-${selected}` : undefined}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        {items.length === 0 ? (
          <p className="type-list-empty">No cell type matches. Clear the search or choose another filter.</p>
        ) : (
          <div style={{ height: items.length * ROW }} className="type-list-inner">
            {items.slice(first, last).map((i, k) => {
              const t = types.list[i];
              return (
                <div
                  key={i}
                  id={`type-option-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  className={i === selected ? "type-row on" : "type-row"}
                  style={{ transform: `translateY(${(first + k) * ROW}px)` }}
                  onClick={() => onSelect(i)}
                >
                  <span className="type-rank">{integer(i + 1)}</span>
                  <span className="type-name">{t.t}</span>
                  <span className={`dot ${t.l}`} title={LABELS[t.l]} />
                  <span className="type-meter" aria-hidden="true">
                    <span style={{ transform: `scaleX(${t.p})` }} />
                  </span>
                  <span className="type-p">{probability(t.p)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Meter({ value, tone = "prediction" }) {
  return (
    <span className={`meter meter-${tone}`} aria-hidden="true">
      <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </span>
  );
}

function wiringValue(column, value) {
  if (column === "pagerank") return scientific(value, 2);
  if (column === "hops_to_motor" && value >= NO_ROUTE_HOPS) return "no route";
  return integer(value);
}

function Section({ title, children, note }) {
  return (
    <section className="detail-section">
      <h3 className="detail-heading">{title}</h3>
      {children}
      {note && <p className="detail-note">{note}</p>}
    </section>
  );
}

function PartnerColumn({ title, pairs, types }) {
  return (
    <div>
      <p className="detail-subheading">{title}</p>
      {pairs.length === 0 ? (
        <p className="detail-note">None above the 1% input threshold.</p>
      ) : (
        <ol className="partner-list">
          {pairs.map(([j, synapses]) => (
            <li key={j}>
              <span className="partner-name">
                <span className={`dot ${types.list[j].l}`} title={LABELS[types.list[j].l]} />
                <TypeLink name={types.list[j].t} />
              </span>
              <span>{integer(synapses)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TypeDetail({ index, types, neuropils, candidates, explanations, wiring, onNeuropil, skeletonCount }) {
  const type = types.list[index];
  const total = types.list.length;
  const reasons = explanations?.[type.t];
  const candidate = candidates.find((c) => c.cell_type === type.t);
  const maxReason = reasons ? Math.max(1, ...reasons.map(([, v]) => Math.abs(v))) : 1;
  const pairs = (row) => Array.from({ length: row.length / 2 }, (_, k) => [row[2 * k], row[2 * k + 1]]);

  const regionFor = (roi) => {
    const matches = neuropils.filter((n) => n.name === roi || n.name.startsWith(`${roi}(`));
    return matches.sort((a, b) => b.synapses - a.synapses)[0];
  };

  return (
    <article className="detail" aria-labelledby="detail-title">
      <header className="detail-head">
        <h2 id="detail-title" className="detail-title">
          {type.t}
        </h2>
        <p className="detail-meta">
          <LabelMark label={type.l} />
          <span>{superclassName(type.s)}</span>
          <span>{type.nt ?? "transmitter unknown"}</span>
          <span>
            {integer(type.n)} {type.n === 1 ? "neuron" : "neurons"}
          </span>
        </p>
      </header>

      <div className="score-block">
        <div>
          <p className="score-value">{probability(type.p)}</p>
          <p className="score-caption">classifier probability, out-of-fold</p>
        </div>
        <div className="score-rank">
          <p>
            <strong>{ordinal(index + 1)}</strong> of {integer(total)}
          </p>
          <span className="rank-bar" aria-hidden="true">
            <span style={{ left: `${(100 * index) / (total - 1)}%` }} />
          </span>
          <p className="score-caption">
            higher than {(Math.floor(1000 * (1 - (index + 1) / total)) / 10).toFixed(1)}% of types
          </p>
        </div>
      </div>

      {candidate && (
        <p className="detail-callout">
          One of the two candidates: annotated isomorphic but in the top 1% of all scores, with{" "}
          {fruDsxText(candidate.fru_dsx)} in the <i>fru</i>/<i>dsx</i> annotation. {candidate.note}
        </p>
      )}

      <Section
        title="Why this score"
        note="SHAP contributions in log-odds from the cross-validation model that scored this type. Magenta raises the score; gray lowers it."
      >
        {reasons ? (
          <ul className="shap-bars">
            {reasons.map(([text, value]) => (
              <li key={text}>
                <span>{text}</span>
                <span className="shap-track">
                  <span className={value > 0 ? "up" : "down"} style={{ width: `${(100 * Math.abs(value)) / maxReason}%` }} />
                </span>
                <span className="shap-value">
                  {value > 0 ? "+" : "−"}
                  {Math.abs(value).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Loading>Loading contributions</Loading>
        )}
      </Section>

      <Section title="Where its synapses are" note="Share of the type's input and output synapses in each neuropil, both sides combined.">
        <ul className="np-list">
          {type.np.map(([roi, share]) => {
            const region = regionFor(roi);
            return (
              <li key={roi}>
                <button type="button" onClick={() => region && onNeuropil(region.name)} disabled={!region}>
                  <span className="np-abbr">{roi}</span>
                  <span className="np-name">{neuropilName(roi) ?? "outside named neuropils"}</span>
                </button>
                <Meter value={share} tone="ink" />
                <span className="np-share">{percent(share, 0)}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Place in the graph"
        note={`Bars show where this type falls among all ${integer(total)} types. ${type.c < 0 ? "In the pooled small wiring communities." : `Member of wiring community ${type.c}.`}`}
      >
        {wiring ? (
          <dl className="wiring-rows">
            {wiring.columns.map((column, c) => {
              if (column === "community") return null;
              const value = wiring.values[index][c];
              return (
                <div key={column}>
                  <dt>{featureLabel(column)}</dt>
                  <dd>
                    <span className="wiring-value">{wiringValue(column, value)}</span>
                    <Meter value={percentile(wiring, c, value)} tone="ink" />
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <Loading>Loading wiring</Loading>
        )}
      </Section>

      <Section title="Strongest partners" note="Synapses on the six strongest connections in each direction that pass the 1% input threshold.">
        {wiring ? (
          <div className="partner-columns">
            <PartnerColumn title="Inputs from" pairs={pairs(wiring.inputs[index])} types={types} />
            <PartnerColumn title="Outputs to" pairs={pairs(wiring.outputs[index])} types={types} />
          </div>
        ) : (
          <Loading>Loading partners</Loading>
        )}
      </Section>

      <p className="detail-note detail-foot">
        {type.b
          ? `The neuron drawn in the brain is one reconstructed cell of this type, body ID ${type.b}.`
          : `No reconstructed neuron is included for this type; the site carries skeletons for ${integer(skeletonCount)} types.`}
      </p>
    </article>
  );
}

function NeuropilDetail({ entry, neuropils, types }) {
  const scored = neuropils.filter((n) => n.score != null);
  const rank = [...scored].sort((a, b) => b.score - a.score).findIndex((n) => n.name === entry.name) + 1;
  const maxShare = Math.max(...entry.topTypes.map(([, s]) => s), 0.01);
  return (
    <article className="detail" aria-labelledby="detail-title">
      <header className="detail-head">
        <h2 id="detail-title" className="detail-title">
          {entry.name}
        </h2>
        <p className="detail-meta">
          <span className="detail-meta-first">{neuropilName(entry.name) ?? "neuropil"}</span>
          <span>{entry.region === "brain" ? "brain" : "ventral nerve cord"}</span>
          <span>{integer(entry.synapses)} typed synapses</span>
        </p>
      </header>

      {entry.score == null ? (
        <p className="detail-note">No typed synapses were assigned to this neuropil.</p>
      ) : (
        <div className="channel-stats">
          <div>
            <p className="channel-label channel-prediction">Mean classifier probability</p>
            <p className="channel-value">{entry.score.toFixed(3)}</p>
            <p className="score-caption">
              {ordinal(rank)} of {scored.length} neuropils
            </p>
          </div>
          <div>
            <p className="channel-label channel-annotation">Synapses made by sex-related types</p>
            <p className="channel-value">{percent(entry.annotatedShare ?? 0)}</p>
            <p className="score-caption">annotated by Janelia</p>
          </div>
        </div>
      )}

      <Section title="Types with the most synapses here" note="Share of all synapses in this neuropil, inputs and outputs, made by each type.">
        <p className="np-types-head" aria-hidden="true">
          <span>Cell type</span>
          <span />
          <span>Share</span>
          <span>Probability</span>
        </p>
        <ol className="np-types">
          {entry.topTypes.map(([name, share]) => {
            const t = types.byName.get(name);
            return (
              <li key={name}>
                <span className="partner-name">
                  {t && <span className={`dot ${t.l}`} title={LABELS[t.l]} />}
                  <TypeLink name={name} />
                </span>
                <Meter value={share / maxShare} tone="ink" />
                <span className="np-share">{percent(share)}</span>
                <span className="np-p">{t ? probability(t.p) : ""}</span>
              </li>
            );
          })}
        </ol>
      </Section>
    </article>
  );
}

function Overview({ types, neuropils, candidates, onNeuropil }) {
  const hottest = neuropils
    .filter((n) => n.region === "brain" && n.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const landmarks = LANDMARKS.filter(([name]) => types.byName.has(name));
  return (
    <article className="detail detail-overview">
      <h2 className="detail-title">How to read the atlas</h2>
      <p className="detail-lede">
        The brain is stained by two measures at once. Pick a cell type from the list to see why the classifier scored it
        as it did, and the neuron itself inside the brain. Click a neuropil in the brain to see which types make its
        synapses.
      </p>

      <Section title="Brightest neuropils">
        <ul className="overview-neuropils">
          {hottest.map((n) => (
            <li key={n.name}>
              <button type="button" onClick={() => onNeuropil(n.name)}>
                <span className="np-abbr">{n.name}</span>
                <span className="np-name">{neuropilName(n.name)}</span>
              </button>
              <span className="np-share">{n.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Places to start">
        <ul className="overview-types">
          <li>
            <TypeLink name={types.list[0].t} />
            <span>The highest-scoring type, annotated {LABELS[types.list[0].l]}</span>
          </li>
          {candidates.map((c) => (
            <li key={c.cell_type}>
              <TypeLink name={c.cell_type} />
              <span>Candidate: annotated isomorphic, scored in the top 1%</span>
            </li>
          ))}
          {landmarks.map(([name, text]) => (
            <li key={name}>
              <TypeLink name={name} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </Section>
      <p className="detail-note">
        Probabilities rank types well but are not calibrated frequencies. How they were computed is in the{" "}
        <a href={href("methods")}>methods</a>.
      </p>
    </article>
  );
}

export default function Atlas({ params }) {
  const data = useAll([loadTypes, loadCandidates, loadNeuropils]);
  const [channel, setChannel] = useState("merge");
  const [cord, setCord] = useState(false);
  const [explanations, setExplanations] = useState(null);
  const [wiring, setWiring] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const detailRef = useRef(null);
  const stageRef = useRef(null);
  const revealPending = useRef(false);

  const typeParam = params.get("type");
  const neuropilParam = params.get("neuropil");
  const types = data.value?.[0];
  const selected = types && typeParam != null ? (types.index.get(typeParam) ?? null) : null;
  const neuropil = data.value && neuropilParam ? (data.value[2].find((n) => n.name === neuropilParam) ?? null) : null;

  useEffect(() => {
    if (selected == null) return;
    if (!explanations) loadExplanations().then(setExplanations, (e) => setLoadError(e.message));
    if (!wiring) loadWiring().then(setWiring, (e) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
    // Runs after the single-column layout has reordered around the new selection.
    if (revealPending.current) {
      revealPending.current = false;
      stageRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
  }, [typeParam, neuropilParam]);

  if (data.error) {
    return (
      <div className="tool-error">
        <ErrorNote>{data.error}</ErrorNote>
      </div>
    );
  }
  if (!data.value) return <Loading>Loading the atlas</Loading>;

  const [, candidates, neuropils] = data.value;
  // On a single-column layout the stage sits above the details, so bring it into view after a selection.
  const revealStage = () => {
    revealPending.current = window.matchMedia("(max-width: 960px)").matches;
  };
  const selectType = (i) => {
    replaceParams("atlas", { type: types.list[i].t });
    revealStage();
  };
  const selectNeuropil = (name) => {
    replaceParams("atlas", { neuropil: name });
    revealStage();
  };
  const clear = () => replaceParams("atlas", null);
  const type = selected != null ? types.list[selected] : null;
  const skeletonCount = types.list.reduce((n, t) => n + (t.b ? 1 : 0), 0);

  let detail;
  if (type) {
    detail = (
      <TypeDetail
        index={selected}
        types={types}
        neuropils={neuropils}
        candidates={candidates}
        explanations={explanations}
        wiring={wiring}
        onNeuropil={selectNeuropil}
        skeletonCount={skeletonCount}
      />
    );
  } else if (neuropil) {
    detail = <NeuropilDetail entry={neuropil} neuropils={neuropils} types={types} />;
  } else if (typeParam || neuropilParam) {
    detail = <p className="detail-note">Nothing in the atlas is named “{typeParam ?? neuropilParam}”. Search the list instead.</p>;
  } else {
    detail = <Overview types={types} neuropils={neuropils} candidates={candidates} onNeuropil={selectNeuropil} />;
  }

  return (
    <div className={`atlas ${type || neuropil ? "atlas-selected" : "atlas-overview"}`}>
      <TypeIndex types={types} selected={selected} onSelect={selectType} />

      <section className="atlas-stage" aria-label="Stained brain" ref={stageRef}>
        <BrainStain
          mode={channel}
          showCord={cord}
          highlight={neuropil?.name}
          neuron={type?.b ? { bodyId: type.b, label: type.l } : null}
          onPickRegion={(entry) => selectNeuropil(entry.name)}
          label="Three-dimensional brain with neuropils colored by classifier probability and annotation"
        />
        <div className="stage-controls">
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
          <label className="field-check">
            <input type="checkbox" checked={cord} onChange={(e) => setCord(e.target.checked)} />
            Show nerve cord
          </label>
        </div>
        <div className="stage-foot">
          <p>{CHANNEL_TEXT[channel]}</p>
          <p className="stage-hint">Drag to rotate, scroll to zoom, click a neuropil to inspect it.</p>
        </div>
      </section>

      <aside className="atlas-detail" ref={detailRef} aria-live="polite">
        {(type || neuropil || typeParam || neuropilParam) && (
          <button type="button" className="button button-quiet detail-close" onClick={clear}>
            Back to overview
          </button>
        )}
        {loadError && <ErrorNote>{loadError}</ErrorNote>}
        {detail}
      </aside>
    </div>
  );
}
