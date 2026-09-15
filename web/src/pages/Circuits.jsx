import { useEffect, useRef, useState } from "react";
import { ErrorNote, LabelMark, Loading } from "../components/ui.jsx";
import { RouteChain, RoutePlate, shareProduct } from "../figures/Neurons.jsx";
import { loadRoutes, loadTypes } from "../lib/data.js";
import { outcomeText } from "../lib/format.js";
import { useAll } from "../lib/hooks.js";
import { href, replaceParams } from "../lib/route.js";

/** Splits "Looming detector to jump motor neuron (Giant Fiber escape pathway)" into name and alias. */
function splitTitle(title) {
  const open = title.lastIndexOf(" (");
  if (open <= 0 || !title.endsWith(")")) return { name: title, alias: null };
  return { name: title.slice(0, open), alias: title.slice(open + 2, -1) };
}

const hops = (n) => `${n} ${n === 1 ? "hop" : "hops"}`;

const listText = (items) =>
  items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Same slate-to-white ramp the route plate uses for its skeletons. */
function stepColor(i, n) {
  const t = i / Math.max(1, n - 1);
  const channel = (base, span) => Math.round(255 * (base + span * t));
  return `rgb(${channel(0.42, 0.5)} ${channel(0.5, 0.44)} ${channel(0.6, 0.38)})`;
}

function Ends({ source, target }) {
  return (
    <>
      <span className="route-type">{source}</span>
      <span className="route-arrow" aria-hidden="true">
        →
      </span>
      <span className="visually-hidden"> to </span>
      <span className="route-type">{target}</span>
    </>
  );
}

function RouteFacts({ route, baseline }) {
  const weakest = Math.min(...route.synapses);
  return (
    <dl className="route-facts">
      <div>
        <dt>Hops</dt>
        <dd>
          {route.hops}
          {baseline && route.hops !== baseline.hops && <span className="route-was">was {baseline.hops}</span>}
        </dd>
      </div>
      <div>
        <dt>Weakest connection</dt>
        <dd>
          {weakest.toLocaleString("en-US")}
          <span className="route-unit">synapses</span>
          {baseline && weakest !== Math.min(...baseline.synapses) && (
            <span className="route-was">was {Math.min(...baseline.synapses).toLocaleString("en-US")}</span>
          )}
        </dd>
      </div>
      <div>
        <dt>Product of output shares</dt>
        <dd>
          {shareProduct(route)}
          {baseline && <span className="route-was">was {shareProduct(baseline)}</span>}
        </dd>
      </div>
    </dl>
  );
}

function AblationResult({ removed, record, ablation, onRestore, buttonRef }) {
  const detour = ablation.route;
  const original = new Set(record.route.types);
  const added = detour ? detour.types.filter((t) => !original.has(t)) : [];
  const ratio = detour ? Math.exp(detour.cost - record.route.cost) : null;
  return (
    <div className="ablation-result">
      <p className="ablation-title">
        <strong>{removed}</strong> removed from the graph
      </p>
      <p className="ablation-body">
        {capitalize(outcomeText(ablation.outcome))}.
        {added.length > 0 && ` It now passes through ${listText(added)}.`}
        {ratio != null &&
          ratio >= 1.05 &&
          ` Its product of output shares is ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio).toLocaleString("en-US")} times smaller.`}
      </p>
      <button ref={buttonRef} type="button" className="button" onClick={onRestore}>
        Restore {removed}
      </button>
    </div>
  );
}

export default function Circuits({ params }) {
  const data = useAll([loadRoutes, loadTypes]);
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const listRef = useRef(null);
  const detailRef = useRef(null);
  const restoreRef = useRef(null);
  const pendingFocus = useRef(null);

  const routes = data.value?.[0];
  const count = routes?.length ?? 0;
  const index = count ? Math.min(count - 1, Math.max(0, Number(params.get("route") ?? 0) || 0)) : 0;
  const removed = params.get("removed");
  const view = `${index}-${removed ?? ""}`;

  useEffect(() => {
    if (!count) return;
    listRef.current?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
    if (detailRef.current) detailRef.current.scrollTop = 0;
  }, [index, count]);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (!target) return;
    if (target === "restore") {
      restoreRef.current?.focus();
      return;
    }
    const buttons = detailRef.current?.querySelectorAll(".chain-remove") ?? [];
    const match = [...buttons].find((b) => b.closest("li")?.querySelector(".chain-name")?.textContent === target);
    (match ?? detailRef.current?.querySelector("h2"))?.focus();
  }, [view]);

  if (data.error) {
    return (
      <div className="tool-error">
        <ErrorNote>{data.error}</ErrorNote>
      </div>
    );
  }
  if (!data.value) {
    return (
      <div className="circuits-loading">
        <Loading>Loading routes</Loading>
      </div>
    );
  }

  const types = data.value[1];
  const record = routes[index];
  const ablation = removed ? record.ablations[removed] : null;
  const shown = ablation ? ablation.route : record.route;
  const title = splitTitle(record.title);
  const pinnedStep = pinned?.view === view ? pinned.step : null;
  const focus = hover ?? pinnedStep;

  const select = (i) => {
    setHover(null);
    replaceParams("circuits", { route: i });
  };
  const remove = (name) => {
    setHover(null);
    pendingFocus.current = "restore";
    replaceParams("circuits", { route: index, removed: name });
  };
  const restore = () => {
    setHover(null);
    pendingFocus.current = removed;
    replaceParams("circuits", { route: index });
  };

  const onListKey = (event) => {
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1 }[event.key];
    if (next == null) return;
    event.preventDefault();
    const clamped = Math.min(count - 1, Math.max(0, next));
    select(clamped);
    listRef.current?.querySelectorAll("button")[clamped]?.focus();
  };

  let guide;
  if (ablation) {
    guide = `Showing the best route that remains without ${removed}. Restore it to try removing a different step.`;
  } else if (removed) {
    guide = `Removing ${removed} was not computed for this route. Choose Remove beside one of its middle steps instead.`;
  } else {
    guide =
      "Each connection lists its synapses and the share of the upstream type's output it carries. Remove a middle step to delete that cell type from the graph and search for the best route that remains.";
  }

  const announcement = ablation
    ? `${removed} removed. ${capitalize(outcomeText(ablation.outcome))}.`
    : `${title.name}, ${hops(record.route.hops)}.`;

  return (
    <div className="circuits">
      <section className="circuits-index" aria-labelledby="circuits-title">
        <header className="circuits-head">
          <h1 id="circuits-title" className="tool-title">
            Circuits
          </h1>
          <p className="tool-lede">
            Each route is the chain of cell types with the largest product of output shares between two types, from
            sensory and courtship neurons to descending and motor neurons. Remove a step to see the best route that
            remains.
          </p>
        </header>

        <div className="circuits-picker">
          <label htmlFor="circuits-route">Route</label>
          <select id="circuits-route" value={index} onChange={(e) => select(Number(e.target.value))}>
            {routes.map((r, i) => (
              <option key={`${r.source}-${r.target}`} value={i}>
                {r.source} to {r.target}: {splitTitle(r.title).name}
              </option>
            ))}
          </select>
        </div>

        <ol className="route-list" ref={listRef} aria-label={`${count} routes`}>
          {routes.map((r, i) => (
            <li key={`${r.source}-${r.target}`}>
              <button
                type="button"
                className={i === index ? "on" : ""}
                aria-current={i === index ? "true" : undefined}
                tabIndex={i === index ? 0 : -1}
                onClick={() => select(i)}
                onKeyDown={onListKey}
              >
                <span className="route-ends">
                  <Ends source={r.source} target={r.target} />
                </span>
                <span className="route-hops">{r.route ? hops(r.route.hops) : "no route"}</span>
                <span className="route-title">{splitTitle(r.title).name}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="circuits-stage" aria-label="Neurons along the route">
        <RoutePlate route={shown} types={types} focus={focus} className="circuits-plate" />
        <div className="circuits-stage-head">
          <p className="circuits-stage-route">
            <Ends source={record.source} target={record.target} />
          </p>
          {ablation && <p className="circuits-stage-state">Best route without {removed}</p>}
        </div>
        <div className="circuits-bar">
          {shown && (
            <ol className="circuits-steps" aria-label="Isolate one step">
              {shown.types.map((name, i) => (
                <li key={`${view}-${name}`}>
                  <button
                    type="button"
                    className={focus === i ? "lit" : ""}
                    aria-pressed={pinnedStep === i}
                    onClick={() => setPinned(pinnedStep === i ? null : { view, step: i })}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHover(i)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <span className="circuits-swatch" style={{ background: stepColor(i, shown.types.length) }} aria-hidden="true" />
                    <span className="circuits-step-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    {name}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <p className="circuits-caption">
            One reconstructed neuron per type, shaded from slate at {record.source} to white at {record.target}. Point
            at a step, or select it, to isolate its neuron.
          </p>
        </div>
      </section>

      <aside className="circuits-detail" ref={detailRef} aria-labelledby="circuits-route-name">
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
        <header>
          <h2 id="circuits-route-name" className="route-name" tabIndex={-1}>
            {title.name}
          </h2>
          {title.alias && <p className="route-alias">{title.alias}</p>}
        </header>

        {ablation && (
          <AblationResult removed={removed} record={record} ablation={ablation} onRestore={restore} buttonRef={restoreRef} />
        )}

        {shown ? (
          <>
            <RouteFacts route={shown} baseline={ablation ? record.route : null} />
            <section className="route-steps" aria-labelledby="circuits-steps-title">
              <h3 id="circuits-steps-title" className="detail-heading">
                Step by step
              </h3>
              <p className="route-guide">{guide}</p>
              <RouteChain
                key={view}
                route={shown}
                types={types}
                onRemove={ablation ? null : remove}
                onFocus={setHover}
              />
              <p className="route-key">
                <span>p is the classifier&apos;s out-of-fold probability that a type is sex-related. Dots show the annotation:</span>
                <LabelMark label="male_specific" />
                <LabelMark label="dimorphic" />
                <LabelMark label="isomorphic" />
              </p>
            </section>
          </>
        ) : (
          <p className="route-guide">No directed route connects these types.</p>
        )}

        <section className="detail-section" aria-labelledby="circuits-method-title">
          <h3 id="circuits-method-title" className="detail-heading">
            How routes are found
          </h3>
          <p className="detail-body">
            Each connection is weighted by −log of the share of the upstream type&apos;s output synapses it carries, so
            the cheapest route is the one whose product of output shares is largest. Dijkstra&apos;s algorithm finds it
            on the thresholded cell-type graph. Removing a type deletes it and all of its connections before searching
            again.
          </p>
          <p className="detail-note">
            Routes describe which synaptic pathways exist, not what a fly would do. Electrical synapses are not in the
            data. More in the <a href={href("methods")}>methods</a>.
          </p>
        </section>
      </aside>
    </div>
  );
}
