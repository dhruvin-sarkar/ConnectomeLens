import { useEffect, useRef, useState } from "react";
import Viewer3D from "../components/Viewer3D.jsx";
import { GLOW, TISSUE, stain } from "../lib/color.js";
import { loadSkeleton } from "../lib/data.js";
import { neuropilName, percent } from "../lib/format.js";
import { prefersReducedMotion, reachesCord } from "../lib/hooks.js";
import { VIEWS } from "../lib/viewer.js";
import { Tooltip } from "./chart.jsx";

const NEURON_WHITE = [0.9, 0.93, 0.96];
// Surfaces add up where neuropils overlap, so each contributes only part of its stain.
const GAIN = 0.24;
// Unstained tissue stays faintly visible whatever the gain.
const FLOOR = TISSUE.map((v) => v * 0.3);
// The nerve cord lies mostly behind the brain; tilting swings it underneath so it stays visible while the view turns.
const CORD_TILT = (55 * Math.PI) / 180;

/**
 * Brain neuropils stained like a two-channel confocal image: magenta for the synapse-weighted classifier
 * probability, green for the share of synapses made by types annotated sex-related, white where both are high.
 * Regions develop from unstained tissue in order of their score on first load. ``neuron`` ({ bodyId, label })
 * draws one reconstructed neuron inside the stained tissue.
 */
export default function BrainStain({ mode, showCord = false, onHoverRegion, onPickRegion, highlight, neuron, label, className = "" }) {
  const [viewer, setViewer] = useState(null);
  const [hover, setHover] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [drawn, setDrawn] = useState(null);
  const [error, setError] = useState(null);
  const neuropils = useRef(null);
  const state = useRef({ current: new Map(), start: 0, delays: new Map() });
  const cord = showCord || Boolean(drawn?.cord);
  const settings = useRef({});
  settings.current = { mode, cord, highlight, translucent: Boolean(drawn) };

  const onReady = (v, entries) => {
    setViewer(v);
    if (!v) return;
    neuropils.current = entries;
    const scored = entries.filter((n) => n.score != null && n.region === "brain");
    const s = state.current;
    s.max = { score: Math.max(...scored.map((n) => n.score)), share: Math.max(...scored.map((n) => n.annotatedShare ?? 0)) };
    const order = entries.filter((n) => n.score != null).sort((a, b) => a.score - b.score);
    s.delays = new Map(order.map((n, i) => [n.name, 0.25 + (1.9 * i) / order.length]));
    s.start = performance.now() / 1000;
    s.instant = prefersReducedMotion();
    for (const n of entries) s.current.set(n.name, [...TISSUE]);
    v.styleNeuropils((entry) => ({ color: TISSUE, visible: entry.region === "brain" }));
    let last = s.start;
    v.onFrame(() => {
      const now = performance.now() / 1000;
      const dt = Math.min(0.1, now - last);
      last = now;
      const { mode: channel, cord: withCord, highlight: focus, translucent } = settings.current;
      const blend = s.instant ? 1 : 1 - Math.exp(-dt * 5);
      v.styleNeuropils((entry) => {
        const developed = s.instant || now - s.start > (s.delays.get(entry.name) ?? 0);
        const target =
          entry.score == null || !developed
            ? TISSUE
            : stain(channel, entry.score / s.max.score, (entry.annotatedShare ?? 0) / s.max.share);
        const current = s.current.get(entry.name);
        for (let k = 0; k < 3; k += 1) current[k] += (target[k] - current[k]) * blend;
        let gain = GAIN;
        if (focus) gain = entry.name === focus ? 0.7 : 0.05;
        else if (translucent) gain = 0.09;
        return {
          color: current.map((v, k) => Math.max(v * gain, FLOOR[k])),
          visible: entry.region === "brain" || withCord,
          emissive: 0.7,
          additive: true,
        };
      });
    });
  };

  useEffect(() => {
    if (!viewer) return undefined;
    setError(null);
    if (!neuron?.bodyId) {
      viewer.clearSkeletons();
      setDrawn(null);
      return undefined;
    }
    let live = true;
    loadSkeleton(neuron.bodyId).then(
      (skeleton) => {
        if (!live) return;
        const color = neuron.label && neuron.label !== "isomorphic" ? GLOW[neuron.label] : NEURON_WHITE;
        viewer.setSkeletons([{ skeleton, color, width: 2 }]);
        setDrawn({ bodyId: neuron.bodyId, cord: reachesCord(skeleton, neuropils.current) });
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
    };
  }, [viewer, neuron?.bodyId, neuron?.label]);

  useEffect(() => {
    if (!viewer) return;
    const meshes = viewer.neuropilMeshes.filter((m) => m.userData.entry.region === "brain" || cord);
    viewer.setTilt(cord ? CORD_TILT : 0);
    viewer.fit(meshes, VIEWS.front, cord ? 0.95 : 0.88);
  }, [viewer, cord]);

  const onHover = (entry, event) => {
    if (!entry || !event) {
      setHover(null);
      onHoverRegion?.(null);
      return;
    }
    // Hover picks are throttled, so the event may arrive after dispatch when currentTarget is already null.
    const rect = event.target.getBoundingClientRect();
    setBounds({ width: rect.width, height: rect.height });
    setHover({ entry, x: event.clientX - rect.left, y: event.clientY - rect.top });
    onHoverRegion?.(entry);
  };

  return (
    <Viewer3D
      className={`brain-stain ${className}`}
      autoRotate
      onReady={onReady}
      onHover={onHover}
      onPick={onPickRegion ? (entry) => entry && onPickRegion(entry) : undefined}
      label={label}
    >
      {error && (
        <p className="viewer-status viewer-error" role="status">
          {error}
        </p>
      )}
      {hover && (
        <Tooltip x={hover.x} y={hover.y} tone="field" bounds={bounds}>
          <strong>{hover.entry.name}</strong>
          {neuropilName(hover.entry.name) && <span className="tooltip-sub">{neuropilName(hover.entry.name)}</span>}
          {hover.entry.score == null ? (
            <span>No typed synapses</span>
          ) : (
            <dl className="tooltip-values">
              <dt className="channel-prediction">Mean probability</dt>
              <dd>{hover.entry.score.toFixed(3)}</dd>
              <dt className="channel-annotation">Annotated sex-related</dt>
              <dd>{percent(hover.entry.annotatedShare ?? 0)} of synapses</dd>
            </dl>
          )}
        </Tooltip>
      )}
    </Viewer3D>
  );
}
