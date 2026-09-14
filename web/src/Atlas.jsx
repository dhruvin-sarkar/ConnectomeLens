import { useEffect, useMemo, useRef, useState } from "react";
import Viewer3D from "./Viewer3D.jsx";
import { css, inferno, scoreColor } from "./colormap.js";
import { loadJSON, loadNeuropils, loadSkeleton, loadTypes } from "./data.js";
import { LABELS, SEX_RELATED, integer, percent, probability, superclassName } from "./format.js";
import { reachesCord, useAsync } from "./hooks.js";
import { VIEWS } from "./viewer.js";

const PAGE = 60;
const UNSCORED = [0.32, 0.32, 0.36];
const SKELETON_COLOR = [0.55, 0.92, 1.0];

function Legend({ vmax }) {
  const stops = Array.from({ length: 11 }, (_, i) => `${css(inferno(0.12 + 0.088 * i))} ${i * 10}%`).join(", ");
  return (
    <div className="legend">
      <div>mean probability of a sex-related type, synapse-weighted per neuropil</div>
      <div className="bar" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <div className="ticks">
        <span>0</span>
        <span>{(vmax / 2).toFixed(2)}</span>
        <span>{vmax.toFixed(2)}</span>
      </div>
    </div>
  );
}

function TypeRow({ type, selected, onSelect }) {
  return (
    <li>
      <button className={selected ? "selected" : ""} onClick={() => onSelect(type.t)} title={LABELS[type.l]}>
        <span className={`dot ${type.l}`} />
        <span className="name">{type.t}</span>
        <span className="meter" aria-hidden="true">
          <span style={{ width: `${Math.max(2, type.p * 100)}%` }} />
        </span>
        <span className="value">{probability(type.p)}</span>
      </button>
    </li>
  );
}

function TypeCard({ type, explanation, onClose }) {
  const maxShap = explanation ? Math.max(...explanation.map(([, v]) => Math.abs(v)), 0.5) : 1;
  return (
    <section className="panel">
      <div className="card-title">
        <h2>{type.t}</h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p>
        <span className="badge">
          <span className={`dot ${type.l}`} /> Janelia annotation: {LABELS[type.l]}
        </span>
      </p>
      <div className="big-number">{probability(type.p)}</div>
      <p className="note">Out-of-fold probability that this type is sex-related, from a model that never saw its label.</p>
      <dl className="facts">
        <dt>neurons</dt>
        <dd>{integer(type.n)}</dd>
        <dt>superclass</dt>
        <dd>{superclassName(type.s)}</dd>
        <dt>transmitter</dt>
        <dd>{type.nt ?? "unknown"} (predicted)</dd>
        <dt>synapses in</dt>
        <dd>{type.np.length ? type.np.map(([n, s]) => `${n} ${percent(s)}`).join(", ") : "no neuropil assignment"}</dd>
      </dl>
      <h3 style={{ marginTop: 14 }}>Largest feature contributions</h3>
      {explanation ? (
        <ul className="bars">
          {explanation.map(([text, value]) => (
            <li key={text} title={`SHAP ${value > 0 ? "+" : ""}${value.toFixed(2)} (log-odds)`}>
              <span>{text}</span>
              <span className="shap">
                <span className={value > 0 ? "up" : "down"} style={{ width: `${(50 * Math.abs(value)) / maxShap}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Loading…</p>
      )}
      <p className="note" style={{ marginTop: 8 }}>
        Orange pushes towards sex-related, blue towards isomorphic. Contributions describe the model, not biology.
      </p>
      <p className="note">
        {type.b
          ? `Morphology: neuron ${type.b}, one representative of this type.`
          : "Morphology is bundled for every sex-related type and the highest-scoring isomorphic types; this type is not included."}
      </p>
    </section>
  );
}

function NeuropilCard({ entry, types, onSelectType, onClose }) {
  return (
    <section className="panel">
      <div className="card-title">
        <h2>{entry.name}</h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {entry.score == null ? (
        <p className="note">No typed-neuron synapses are assigned to this region.</p>
      ) : (
        <>
          <div className="big-number">{entry.score.toFixed(3)}</div>
          <p className="note">
            Mean out-of-fold probability over {integer(entry.synapses)} synapses, each synapse weighted by the probability
            of its neuron's type.
          </p>
          <h3 style={{ marginTop: 12 }}>Types with the most synapses here</h3>
          <ul className="bars">
            {entry.topTypes.map(([name, share]) => {
              const type = types.byName.get(name);
              return (
                <li key={name}>
                  <button className="clickable" onClick={() => onSelectType(name)}>
                    <span className={`dot ${type?.l}`} /> {name} <span className="note">{percent(share)} of synapses</span>
                  </button>
                  <span className="note">p {type ? probability(type.p) : "n/a"}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export default function Atlas() {
  const types = useAsync(loadTypes, []);
  const neuropils = useAsync(loadNeuropils, []);
  const [viewer, setViewer] = useState(null);
  const [selected, setSelected] = useState(null);
  const [region, setRegion] = useState(null);
  const [showCord, setShowCord] = useState(false);
  const [skeleton, setSkeleton] = useState(null);
  const [explanations, setExplanations] = useState(null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("all");
  const [superclass, setSuperclass] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [hovered, setHovered] = useState(null);
  const tooltip = useRef(null);

  const vmax = useMemo(() => {
    const scores = (neuropils.value ?? []).map((n) => n.score ?? 0);
    return scores.length ? Math.ceil(Math.max(...scores) * 10) / 10 : 1;
  }, [neuropils.value]);

  const type = selected && types.value ? types.value.byName.get(selected) : null;

  useEffect(() => {
    if (type) loadJSON("explanations.json").then(setExplanations);
  }, [type]);

  useEffect(() => {
    setSkeleton(null);
    if (!type?.b || !neuropils.value) return;
    let live = true;
    loadSkeleton(type.b).then((s) => {
      if (!live) return;
      setSkeleton(s);
      if (reachesCord(s, neuropils.value)) setShowCord(true);
    });
    return () => {
      live = false;
    };
  }, [type, neuropils.value]);

  useEffect(() => {
    if (viewer) viewer.setSkeletons(skeleton ? [{ skeleton, color: SKELETON_COLOR, width: 1.8 }] : []);
  }, [viewer, skeleton]);

  useEffect(() => {
    if (!viewer) return;
    viewer.styleNeuropils((entry) => {
      const color = entry.score == null ? UNSCORED : scoreColor(entry.score, vmax);
      const visible = entry.region === "brain" || showCord;
      if (skeleton) return { color, opacity: 0.08, visible, pickable: false };
      if (region) return { color, opacity: entry.name === region ? 1 : 0.16, visible };
      return { color, opacity: 1, visible };
    });
  }, [viewer, skeleton, region, showCord, vmax]);

  useEffect(() => {
    if (viewer) viewer.fit(undefined, showCord ? VIEWS.oblique : VIEWS.front);
  }, [viewer, showCord]);

  const superclasses = useMemo(
    () => [...new Set((types.value?.list ?? []).map((t) => t.s).filter(Boolean))].sort(),
    [types.value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (types.value?.list ?? []).filter(
      (t) =>
        (!q || t.t.toLowerCase().includes(q)) &&
        (label === "all" || (label === "sex_related" ? SEX_RELATED.has(t.l) : t.l === label)) &&
        (superclass === "all" || t.s === superclass),
    );
  }, [types.value, query, label, superclass]);

  const selectType = (name) => {
    setSelected(name);
    setRegion(null);
  };

  const onHover = (entry, event) => {
    setHovered(entry?.name ?? null);
    if (entry && event && tooltip.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      tooltip.current.style.left = `${event.clientX - rect.left}px`;
      tooltip.current.style.top = `${event.clientY - rect.top}px`;
    }
  };

  const hoveredEntry = hovered ? neuropils.value?.find((n) => n.name === hovered) : null;
  const regionEntry = region ? neuropils.value?.find((n) => n.name === region) : null;
  const error = types.error ?? neuropils.error;

  return (
    <div className="mode">
      <div className="stage">
        <Viewer3D
          onReady={setViewer}
          onHover={onHover}
          onPick={(entry) => {
            if (!entry) return;
            setSelected(null);
            setRegion(entry.name);
          }}
        >
          <div className="tooltip" ref={tooltip} hidden={!hoveredEntry}>
            {hoveredEntry && (
              <>
                <strong>{hoveredEntry.name}</strong>{" "}
                {hoveredEntry.score == null ? "no typed synapses" : hoveredEntry.score.toFixed(3)}
              </>
            )}
          </div>
        </Viewer3D>
        <div className="overlay top-left">
          <Legend vmax={vmax} />
        </div>
        <div className="overlay top-right">
          <label className="toggle">
            <input type="checkbox" checked={showCord} onChange={(e) => setShowCord(e.target.checked)} />
            ventral nerve cord
          </label>
        </div>
        <div className="overlay bottom-left">
          {skeleton && type ? `${type.t}: neuron ${skeleton.bodyId}` : "Drag to rotate, scroll to zoom, click a neuropil"}
        </div>
      </div>

      <aside className="sidebar">
        {error && <p className="error">{error}</p>}
        {type && <TypeCard type={type} explanation={explanations?.[type.t]} onClose={() => setSelected(null)} />}
        {!type && regionEntry && types.value && (
          <NeuropilCard entry={regionEntry} types={types.value} onSelectType={selectType} onClose={() => setRegion(null)} />
        )}
        {!type && !regionEntry && (
          <section className="panel">
            <h2>How to read this</h2>
            <p className="note">
              Every one of the {integer(types.value?.list.length ?? 0)} cell types was scored by a classifier trained on
              wiring features from the male connectome alone. Colors show where high-scoring types concentrate. Pick a
              neuropil or a cell type to see why the model scored it as it did.
            </p>
          </section>
        )}

        <section className="panel">
          <h2>Cell types ranked by probability</h2>
          <div className="filters">
            <input
              type="search"
              placeholder="Search cell types"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              aria-label="Search cell types"
            />
            <select value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Filter by annotation">
              <option value="all">all annotations</option>
              <option value="sex_related">sex-related</option>
              <option value="male_specific">male-specific</option>
              <option value="dimorphic">sexually dimorphic</option>
              <option value="isomorphic">isomorphic</option>
            </select>
            <select value={superclass} onChange={(e) => setSuperclass(e.target.value)} aria-label="Filter by superclass">
              <option value="all">all superclasses</option>
              {superclasses.map((s) => (
                <option key={s} value={s}>
                  {superclassName(s)}
                </option>
              ))}
            </select>
          </div>
          <p className="note" style={{ margin: "8px 0 0" }}>
            {integer(filtered.length)} types · <span className="dot male_specific" /> male-specific{" "}
            <span className="dot dimorphic" /> dimorphic <span className="dot isomorphic" /> isomorphic
          </p>
          <ul className="type-list">
            {filtered.slice(0, limit).map((t) => (
              <TypeRow key={t.t} type={t} selected={t.t === selected} onSelect={selectType} />
            ))}
          </ul>
          {filtered.length > limit && (
            <button className="more" onClick={() => setLimit(limit + PAGE)}>
              Show more
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}
