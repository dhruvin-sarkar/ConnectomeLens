import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Viewer3D from "../components/Viewer3D.jsx";
import { Figure, LabelMark, TypeLink } from "../components/ui.jsx";
import { GLOW } from "../lib/color.js";
import { loadSkeleton } from "../lib/data.js";
import { LABELS, fruDsxText, integer, outcomeText, percent, probability, scientific } from "../lib/format.js";
import { prefersReducedMotion, reachesCord } from "../lib/hooks.js";
import { href } from "../lib/route.js";
import { VIEWS } from "../lib/viewer.js";

// Faint tissue: surfaces add up where neuropils overlap, so each one is very dim.
const CONTEXT = [0.035, 0.038, 0.045];

/** One neuron's skeleton inside faint neuropil outlines; the nerve cord is shown only if the neuron reaches it. */
export function SkeletonPlate({ bodyId, label = "isomorphic", autoRotate = true, className = "", description, children }) {
  const [viewer, setViewer] = useState(null);
  const [neuropils, setNeuropils] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!viewer || !neuropils || !bodyId) return undefined;
    let live = true;
    viewer.clearSkeletons();
    loadSkeleton(bodyId).then(
      (skeleton) => {
        if (!live) return;
        const cord = reachesCord(skeleton, neuropils);
        viewer.styleNeuropils((entry) => ({
          color: CONTEXT,
          additive: true,
          visible: entry.region === "brain" || cord,
          pickable: false,
        }));
        const color = label === "isomorphic" ? [0.86, 0.9, 0.95] : GLOW[label];
        const lines = viewer.setSkeletons([{ skeleton, color, width: 1.7 }]);
        viewer.fit(lines, cord ? VIEWS.side : VIEWS.front, 1.3);
      },
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [viewer, neuropils, bodyId, label]);

  return (
    <Viewer3D
      className={`skeleton-plate ${className}`}
      autoRotate={autoRotate}
      label={description}
      onReady={(v, n) => {
        setViewer(v);
        setNeuropils(n);
      }}
    >
      {error && <p className="viewer-status viewer-error">{error}</p>}
      {children}
    </Viewer3D>
  );
}

export function CandidatesFigure({ candidates, types, explanations, summary, number }) {
  const stats = summary.candidates;
  return (
    <Figure
      number={number}
      variant="field"
      title="The two annotated isomorphic types the classifier scores highest"
      caption={
        <>
          The rule for candidates was fixed in advance: types annotated isomorphic whose out-of-fold probability is in
          the top 1% of all types (at least {stats.threshold.toFixed(3)}). Only these two qualify. The model never saw{" "}
          <i>fruitless</i> or <i>doublesex</i> expression, yet both carry a <i>fru</i>/<i>dsx</i> annotation (low <i>fru</i>), as do{" "}
          {integer(stats.fru_dsx_other_isomorphic)} of the other {integer(stats.n_other_isomorphic)} isomorphic types
          (one-sided Fisher exact test, p = {stats.fisher_p_value.toFixed(4)}). Contributions are SHAP values, in
          log-odds, from the fold model that scored each type. {candidates[0].note}
        </>
      }
    >
      <div className="candidates">
        {candidates.map((c) => {
          const type = types.byName.get(c.cell_type);
          const rank = types.index.get(c.cell_type) + 1;
          const reasons = explanations?.[c.cell_type] ?? [];
          return (
            <article key={c.cell_type} className="candidate">
              <SkeletonPlate bodyId={type.b} className="candidate-plate" description={`Reconstructed neuron of cell type ${c.cell_type}`} />
              <div className="candidate-body">
                <h4 className="candidate-name">{c.cell_type}</h4>
                <p className="candidate-meta">
                  Probability {probability(c.oof_probability)}, rank {integer(rank)} of {integer(types.list.length)}.
                  Annotated <LabelMark label={type.l} />.
                </p>
                <dl className="candidate-facts">
                  <div>
                    <dt>
                      <i>fru</i> or <i>dsx</i> annotation
                    </dt>
                    <dd>{fruDsxText(c.fru_dsx)}</dd>
                  </div>
                  <div>
                    <dt>Partners annotated sex-related</dt>
                    <dd>{percent(c.sex_related_partner_share, 0)}</dd>
                  </div>
                  <div>
                    <dt>Neurons of this type</dt>
                    <dd>{integer(c.n_neurons)}</dd>
                  </div>
                </dl>
                <p className="candidate-heading">Largest contributions to its score</p>
                <ul className="shap-bars shap-bars-field">
                  {reasons.map(([text, value]) => (
                    <li key={text}>
                      <span>{text}</span>
                      <span className="shap-track">
                        <span className={value > 0 ? "up" : "down"} style={{ width: `${Math.min(100, (Math.abs(value) / 4) * 100)}%` }} />
                      </span>
                      <span className="shap-value">
                        {value > 0 ? "+" : "−"}
                        {Math.abs(value).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <a className="button button-field-quiet" href={href("atlas", { type: c.cell_type })}>
                  Open {c.cell_type} in the atlas
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </Figure>
  );
}

/** Route skeletons lit in order from source to target; ``focus`` dims every step but one. */
export function RoutePlate({ route, types, focus = null, className = "" }) {
  const [viewer, setViewer] = useState(null);
  const [error, setError] = useState(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    if (viewer) viewer.styleNeuropils(() => ({ color: CONTEXT, additive: true, pickable: false }));
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return undefined;
    if (!route) {
      viewer.clearSkeletons();
      return undefined;
    }
    let live = true;
    let stop;
    const bodies = route.types.map((t) => types.byName.get(t)?.b);
    Promise.all(bodies.map((b) => (b ? loadSkeleton(b) : null))).then(
      (skeletons) => {
        if (!live) return;
        const n = route.types.length;
        const ramp = (i) => {
          const t = i / Math.max(1, n - 1);
          return [0.42 + 0.5 * t, 0.5 + 0.44 * t, 0.6 + 0.38 * t];
        };
        const items = skeletons.map((skeleton, i) => skeleton && { skeleton, step: i, color: ramp(i) }).filter(Boolean);
        const lines = viewer.setSkeletons(items.map((item) => ({ ...item, width: 1.4 })));
        viewer.fit(lines, VIEWS.side, 1.15);
        const base = items.map((item) => new THREE.Color().setRGB(...item.color, THREE.SRGBColorSpace));
        const white = new THREE.Color(1, 1, 1);
        const still = prefersReducedMotion();
        stop = viewer.onFrame((time) => {
          const phase = (time * 0.9) % (n + 1.2);
          lines.forEach((line, k) => {
            const step = items[k].step;
            const pulse = still ? 0 : Math.exp(-((phase - step - 0.5) ** 2) / 0.18);
            const dimmed = focusRef.current != null && focusRef.current !== step;
            line.material.color.copy(base[k]).lerp(white, 0.75 * pulse);
            line.material.opacity = dimmed ? 0.12 : 1;
            line.material.transparent = dimmed;
            line.material.linewidth = (focusRef.current === step ? 2.6 : 1.3) + 2.2 * pulse;
          });
        });
      },
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [viewer, route, types]);

  return (
    <Viewer3D className={`route-plate ${className}`} onReady={setViewer} label="Reconstructed neurons along the route">
      {error && <p className="viewer-status viewer-error">{error}</p>}
    </Viewer3D>
  );
}

/** Route as an ordered chain of types with the synapses and output share of each connection. */
export function RouteChain({ route, types, onRemove, onFocus, tone = "paper" }) {
  const n = route.types.length;
  return (
    <ol className={`chain chain-${tone}`}>
      {route.types.map((name, i) => {
        const type = types.byName.get(name);
        const share = route.shares[i - 1];
        return (
          <li
            key={`${name}-${i}`}
            onPointerEnter={() => onFocus?.(i)}
            onPointerLeave={() => onFocus?.(null)}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            {i > 0 && (
              <div className="chain-edge">
                <span className="chain-line" style={{ width: `${Math.max(2, Math.min(8, 2 + Math.log10(share * 1000) * 2))}px` }} />
                <span className="chain-edge-text">
                  {integer(route.synapses[i - 1])} synapses, {percent(share, share < 0.1 ? 1 : 0)} of {route.types[i - 1]} output
                </span>
              </div>
            )}
            <div className="chain-step">
              <span className="chain-index">{i + 1}</span>
              <span className="chain-name">
                <TypeLink name={name} />
              </span>
              <span className="chain-meta">
                <span className={`dot ${type.l}`} title={LABELS[type.l]} /> p {probability(type.p)}
              </span>
              {onRemove && i > 0 && i < n - 1 && (
                <button type="button" className="chain-remove" onClick={() => onRemove(name)} aria-label={`Remove ${name} from the graph and search again`}>
                  Remove
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const shareProduct = (route) => scientific(Math.exp(-route.cost), 2);

export function CircuitFigure({ routes, types, number }) {
  const giantFiber = routes.slice(0, 3);
  const [index, setIndex] = useState(0);
  const [removed, setRemoved] = useState(null);
  const [focus, setFocus] = useState(null);
  const record = giantFiber[index];
  const ablation = removed ? record.ablations[removed] : null;
  const shown = ablation ? ablation.route : record.route;

  return (
    <Figure
      number={number}
      variant="field"
      title="The Giant Fiber escape pathway, found from the graph alone"
      controls={
        <div className="route-tabs" role="tablist" aria-label="Route">
          {giantFiber.map((r, i) => (
            <button
              key={`${r.source}-${r.target}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={i === index ? "on" : ""}
              onClick={() => {
                setIndex(i);
                setRemoved(null);
              }}
            >
              {r.source} → {r.target}
            </button>
          ))}
        </div>
      }
      caption={
        <>
          Routes are weighted shortest paths on the cell-type graph. Each connection costs −log of its share of the
          upstream type&apos;s output synapses, so the route found is the one whose product of output shares is largest. One
          reconstructed neuron per type is shown, lit in order from source to target; hover a step to isolate it.
          Removing a type deletes it from the graph and searches again. This is structural: it shows which alternative
          synaptic routes exist, not what a fly would do. Electrical synapses, which carry part of the Giant Fiber&apos;s
          output, are not in the data.
        </>
      }
    >
      <div className="circuit">
        <RoutePlate route={shown} types={types} focus={focus} className="circuit-plate" />
        <div className="circuit-side">
          <p className="circuit-title">{record.title}</p>
          {shown ? (
            <RouteChain route={shown} types={types} onRemove={removed ? null : setRemoved} onFocus={setFocus} tone="field" key={`${index}-${removed ?? "original"}`} />
          ) : (
            <p className="circuit-empty">No directed route remains.</p>
          )}
          {ablation ? (
            <div className="circuit-result" role="status">
              <p>
                Without <strong>{removed}</strong>, {outcomeText(ablation.outcome)}.{" "}
                {ablation.route
                  ? `It takes ${ablation.route.hops} hops instead of ${record.route.hops}, and the product of output shares falls from ${shareProduct(record.route)} to ${shareProduct(ablation.route)}.`
                  : "No route connects these types."}
              </p>
              <button type="button" className="button button-field" onClick={() => setRemoved(null)}>
                Restore {removed}
              </button>
            </div>
          ) : (
            <p className="circuit-hint">
              {record.route.hops} hops, product of output shares {shareProduct(record.route)}. Remove an intermediate type
              to see the best detour.
            </p>
          )}
          <a className="circuit-more" href={href("circuits")}>
            Explore all {routes.length} routes
          </a>
        </div>
      </div>
    </Figure>
  );
}
