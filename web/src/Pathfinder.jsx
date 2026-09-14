import { useEffect, useState } from "react";
import * as THREE from "three";
import Viewer3D from "./Viewer3D.jsx";
import { css, inferno } from "./colormap.js";
import { loadJSON, loadSkeleton, loadTypes } from "./data.js";
import { LABELS, integer, percent, probability } from "./format.js";
import { useAsync } from "./hooks.js";
import { VIEWS } from "./viewer.js";

const CONTEXT = [0.55, 0.57, 0.66];
const WHITE = new THREE.Color(1, 1, 1);
const routeColor = (i, n) => inferno(0.34 + (0.6 * i) / Math.max(1, n - 1));
const shareProduct = (route) => Math.exp(-route.cost).toExponential(2);

function Route({ route, types, onRemove }) {
  const n = route.types.length;
  return (
    <ol className="chain">
      {route.types.map((name, i) => {
        const type = types.byName.get(name);
        return (
          <li key={name}>
            {i > 0 && (
              <div className="edge">
                {integer(route.synapses[i - 1])} synapses, {percent(route.shares[i - 1])} of {route.types[i - 1]} output
              </div>
            )}
            <div className="step">
              <span className="swatch" style={{ background: css(routeColor(i, n)) }} />
              <span className="name">{name}</span>
              <span className="meta" title={`Janelia annotation: ${LABELS[type.l]}`}>
                <span className={`dot ${type.l}`} /> p {probability(type.p)}
              </span>
              {onRemove && i > 0 && i < n - 1 && (
                <button onClick={() => onRemove(name)} aria-label={`Remove ${name} from the graph`}>
                  remove
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function Pathfinder() {
  const routes = useAsync(() => loadJSON("routes.json"), []);
  const types = useAsync(loadTypes, []);
  const [viewer, setViewer] = useState(null);
  const [index, setIndex] = useState(0);
  const [removed, setRemoved] = useState(null);
  const [error, setError] = useState(null);

  const record = routes.value?.[index];
  const ablation = record && removed ? record.ablations[removed] : null;
  const shown = ablation ? ablation.route : record?.route;

  useEffect(() => {
    if (viewer) viewer.styleNeuropils(() => ({ color: CONTEXT, opacity: 0.035, pickable: false }));
  }, [viewer]);

  useEffect(() => {
    if (!viewer || !types.value) return;
    if (!shown) {
      viewer.clearSkeletons();
      return;
    }
    let live = true;
    let stop;
    const bodies = shown.types.map((t) => types.value.byName.get(t)?.b);
    Promise.all(bodies.map((b) => (b ? loadSkeleton(b) : null))).then(
      (skeletons) => {
        if (!live) return;
        const n = shown.types.length;
        const items = skeletons
          .map((skeleton, i) => skeleton && { skeleton, color: routeColor(i, n), step: i })
          .filter(Boolean);
        const lines = viewer.setSkeletons(items);
        viewer.fit(lines, VIEWS.side, 1.2);
        const base = items.map((item) => new THREE.Color(...item.color));
        stop = viewer.onFrame((time) => {
          const phase = (time * 1.2) % (n + 1);
          lines.forEach((line, k) => {
            const pulse = Math.exp(-((phase - items[k].step - 0.5) ** 2) / 0.22);
            line.material.color.copy(base[k]).lerp(WHITE, 0.7 * pulse);
            line.material.linewidth = 1.3 + 2.4 * pulse;
          });
        });
      },
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [viewer, shown, types.value]);

  const loadError = routes.error ?? types.error ?? error;

  return (
    <div className="mode">
      <div className="stage">
        <Viewer3D onReady={setViewer} />
        <div className="overlay top-left">
          {record && (
            <>
              <strong style={{ color: "var(--text)" }}>
                {record.source} → {record.target}
              </strong>
              <div>{record.title}</div>
            </>
          )}
        </div>
        <div className="overlay bottom-left">
          {shown
            ? "One representative neuron per type, lit in order from source to target. Drag to rotate."
            : "No route remains."}
        </div>
      </div>

      <aside className="sidebar">
        {loadError && <p className="error">{loadError}</p>}
        {record && types.value && (
          <section className="panel">
            <h2>{removed ? "Original route" : "Strongest route"}</h2>
            <Route route={record.route} types={types.value} onRemove={removed ? null : setRemoved} />
            <p className="note" style={{ marginTop: 10 }}>
              Product of output shares along the route: {shareProduct(record.route)}.
              {!removed && " Remove an intermediate type to delete it from the graph and search again."}
            </p>
          </section>
        )}

        {ablation && (
          <section className="panel">
            <h2>Without {removed}</h2>
            <div className="outcome">
              {ablation.route ? (
                <>
                  Outcome: <strong>{ablation.outcome}</strong>, {ablation.route.hops} hops instead of {record.route.hops}.
                  The product of output shares changes from {shareProduct(record.route)} to {shareProduct(ablation.route)}.
                </>
              ) : (
                <>
                  Outcome: <strong>disconnected</strong>. No directed route from {record.source} to {record.target} remains.
                </>
              )}
              <div>
                <button onClick={() => setRemoved(null)}>Restore {removed}</button>
              </div>
            </div>
            {ablation.route && (
              <div style={{ marginTop: 12 }}>
                <Route route={ablation.route} types={types.value} />
              </div>
            )}
          </section>
        )}

        <section className="panel">
          <h2>Curated routes</h2>
          <ul className="route-list">
            {(routes.value ?? []).map((r, i) => (
              <li key={`${r.source}-${r.target}`}>
                <button
                  className={i === index ? "selected" : ""}
                  onClick={() => {
                    setIndex(i);
                    setRemoved(null);
                  }}
                >
                  <span className="endpoints">
                    {r.source} → {r.target}
                  </span>
                  <span className="title">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>What this shows</h2>
          <p className="note">
            Routes are weighted shortest paths on the cell-type graph. Each connection costs −log of its share of the
            upstream type's output synapses, so the route keeps the largest share of signal at every step. The Giant
            Fiber (DNp01) route from the looming detector LPLC2 to the jump motor neuron TTMn is recovered from the graph
            alone.
          </p>
          <p className="note">
            Removal is structural: it shows which alternative synaptic routes exist, not what a fly would do without that
            neuron. Only chemical synapses are counted; electrical synapses, which carry part of the Giant Fiber's output,
            are not in the data.
          </p>
        </section>
      </aside>
    </div>
  );
}
