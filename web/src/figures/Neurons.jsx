import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Viewer3D from "../components/Viewer3D.jsx";
import { Figure, LabelMark, Segmented, TypeLink } from "../components/ui.jsx";
import { GLOW } from "../lib/color.js";
import { loadSkeleton } from "../lib/data.js";
import { LABELS, fruDsxText, integer, outcomeText, percent, probability, shareProduct } from "../lib/format.js";
import { prefersReducedMotion, reachesCord } from "../lib/hooks.js";
import { href } from "../lib/route.js";
import { VIEWS } from "../lib/viewer.js";

export { shareProduct };

// Faint tissue: surfaces add up where neuropils overlap, so each one is very dim.
const CONTEXT = [0.035, 0.038, 0.045];

/** True once ``active`` has held for ``delay`` ms, so cached loads never flash a status line. */
function useDelayed(active, delay = 250) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return undefined;
    }
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && elapsed;
}

function PlateStatus({ error, children }) {
  if (error) {
    return (
      <p className="viewer-status viewer-error" role="status">
        {error}
      </p>
    );
  }
  return children ? (
    <p className="viewer-status" role="status">
      {children}
    </p>
  ) : null;
}

const NEURON_WHITE = [0.86, 0.9, 0.95];
const skeletonColor = (label) => (label === "isomorphic" ? NEURON_WHITE : (GLOW[label] ?? NEURON_WHITE));

/**
 * One neuron's skeleton inside faint neuropil outlines; the nerve cord is shown only if the neuron reaches it.
 * ``rotateControl`` shows the pause button of an auto-rotating view.
 */
export function SkeletonPlate({
  bodyId,
  label = "isomorphic",
  autoRotate = true,
  rotateControl = true,
  className = "",
  description,
  children,
}) {
  const [viewer, setViewer] = useState(null);
  const [neuropils, setNeuropils] = useState(null);
  const [drawn, setDrawn] = useState(null);
  const [error, setError] = useState(null);
  const lines = useRef([]);
  const labelRef = useRef(label);
  labelRef.current = label;
  const loading = useDelayed(Boolean(viewer && bodyId && drawn !== bodyId && !error));

  useEffect(() => {
    if (!viewer) return;
    viewer.styleNeuropils((entry) => ({ color: CONTEXT, additive: true, visible: entry.region === "brain", pickable: false }));
    viewer.fit(null, VIEWS.front, 1.15);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || !neuropils) return undefined;
    setError(null);
    viewer.clearSkeletons();
    lines.current = [];
    if (!bodyId) {
      setDrawn(null);
      return undefined;
    }
    let live = true;
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
        lines.current = viewer.setSkeletons([{ skeleton, color: skeletonColor(labelRef.current), width: 1.7 }]);
        viewer.fit(lines.current, cord ? VIEWS.side : VIEWS.front, 1.3);
        setDrawn(bodyId);
      },
      (e) => {
        if (!live) return;
        setDrawn(null);
        setError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, [viewer, neuropils, bodyId]);

  useEffect(() => {
    const [r, g, b] = skeletonColor(label);
    for (const line of lines.current) line.material.color.setRGB(r, g, b, THREE.SRGBColorSpace);
  }, [label]);

  let status = null;
  if (viewer && !bodyId) status = "No reconstructed neuron for this type";
  else if (loading) status = "Loading neuron";

  return (
    <Viewer3D
      className={`skeleton-plate ${className}`}
      autoRotate={autoRotate}
      rotateControl={rotateControl}
      label={description}
      onReady={(v, n) => {
        setViewer(v);
        setNeuropils(n);
      }}
    >
      <PlateStatus error={error}>{status}</PlateStatus>
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
  const [drawn, setDrawn] = useState(null);
  const [error, setError] = useState(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const loading = useDelayed(Boolean(viewer && route && drawn !== route && !error));

  useEffect(() => {
    if (!viewer) return;
    viewer.styleNeuropils(() => ({ color: CONTEXT, additive: true, pickable: false }));
    viewer.fit(null, VIEWS.side, 1.05);
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return undefined;
    setError(null);
    viewer.clearSkeletons();
    if (!route) {
      setDrawn(null);
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
        setDrawn(route);
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
      (e) => {
        if (!live) return;
        viewer.clearSkeletons();
        setDrawn(null);
        setError(e.message);
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [viewer, route, types]);

  let status = null;
  if (viewer && !route) status = "No directed route to show";
  else if (loading) status = "Loading neurons";

  return (
    <Viewer3D className={`route-plate ${className}`} onReady={setViewer} label="Reconstructed neurons along the route">
      <PlateStatus error={error}>{status}</PlateStatus>
    </Viewer3D>
  );
}

// Focus moved by a script after a pointer click should not isolate a step; keyboard focus should.
function keyboardFocus(element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Route as an ordered chain of types with the synapses and output share of each connection. */
export function RouteChain({ route, types, onRemove, onFocus, focused = null, tone = "paper" }) {
  const n = route.types.length;
  const touch = useRef(false);
  return (
    <ol className={`chain chain-${tone}`}>
      {route.types.map((name, i) => {
        const type = types.byName.get(name);
        const share = route.shares[i - 1];
        return (
          <li
            key={`${name}-${i}`}
            onPointerDown={(event) => {
              touch.current = event.pointerType === "touch";
            }}
            onPointerEnter={(event) => event.pointerType !== "touch" && onFocus?.(i)}
            onPointerLeave={(event) => event.pointerType !== "touch" && onFocus?.(null)}
            onClick={(event) => {
              // Touch has no hover, so a tap toggles isolation; links and buttons keep their own action.
              if (!touch.current || event.target.closest("a, button")) return;
              onFocus?.(focused === i ? null : i);
            }}
            onFocus={(event) => keyboardFocus(event.target) && onFocus?.(i)}
            onBlur={() => onFocus?.(null)}
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
                <span className={`dot ${type.l}`} role="img" aria-label={LABELS[type.l]} /> p {probability(type.p)}
              </span>
              {onRemove && i > 0 && i < n - 1 && (
                <button
                  type="button"
                  className="chain-remove"
                  data-type={name}
                  onClick={() => onRemove(name)}
                  aria-label={`Remove ${name} from the graph and search again`}
                >
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

function detourText(record, ablation) {
  const detour = ablation.route;
  if (!detour) return "No route connects these types.";
  const before = shareProduct(record.route);
  const after = shareProduct(detour);
  const product =
    before === after
      ? `the product of output shares stays at ${after}`
      : `the product of output shares falls from ${before} to ${after}`;
  // The outcome sentence already says when the hop count is unchanged.
  if (detour.hops === record.route.hops) return `${product.charAt(0).toUpperCase()}${product.slice(1)}.`;
  return `It takes ${detour.hops} hops instead of ${record.route.hops}, and ${product}.`;
}

export function CircuitFigure({ routes, types, number }) {
  const giantFiber = routes.slice(0, 3);
  const [index, setIndex] = useState(0);
  const [removed, setRemoved] = useState(null);
  const [focus, setFocus] = useState(null);
  const record = giantFiber[index];
  const ablation = removed && record.route ? (record.ablations?.[removed] ?? null) : null;
  const shown = ablation ? ablation.route : record.route;

  const choose = (i) => {
    setFocus(null);
    setRemoved(null);
    setIndex(i);
  };
  const remove = (name) => {
    setFocus(null);
    setRemoved(name);
  };
  const restore = () => {
    setFocus(null);
    setRemoved(null);
  };

  let hint = "No directed route connects these types.";
  if (record.route) {
    hint = `${record.route.hops} hops, product of output shares ${shareProduct(record.route)}. Remove an intermediate type to see the best detour.`;
  }

  return (
    <Figure
      number={number}
      variant="field"
      title="The Giant Fiber escape pathway, found from the graph alone"
      controls={
        <Segmented
          tone="field"
          label="Route"
          value={index}
          onChange={choose}
          options={giantFiber.map((r, i) => ({
            value: i,
            label: (
              <>
                {r.source}
                <span aria-hidden="true"> → </span>
                <span className="visually-hidden"> to </span>
                {r.target}
              </>
            ),
          }))}
        />
      }
      caption={
        <>
          Routes are weighted shortest paths on the cell-type graph. Each connection costs −log of its share of the
          upstream type&apos;s output synapses, so the route found is the one whose product of output shares is largest. One
          reconstructed neuron per type is shown, lit in order from source to target; hover, tap or focus a step to isolate it.
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
            <RouteChain route={shown} types={types} onRemove={removed ? null : remove} onFocus={setFocus} focused={focus} tone="field" key={`${index}-${removed ?? "original"}`} />
          ) : (
            <p className="circuit-empty">No directed route remains.</p>
          )}
          {ablation ? (
            <div className="circuit-result" role="status">
              <p>
                Without <strong>{removed}</strong>, {outcomeText(ablation.outcome)}. {detourText(record, ablation)}
              </p>
              <button type="button" className="button button-field" onClick={restore}>
                Restore {removed}
              </button>
            </div>
          ) : (
            <p className="circuit-hint">{hint}</p>
          )}
          <a className="circuit-more" href={href("circuits")}>
            Explore all {routes.length} routes
          </a>
        </div>
      </div>
    </Figure>
  );
}
