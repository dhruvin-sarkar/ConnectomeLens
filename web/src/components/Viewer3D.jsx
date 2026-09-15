import { useEffect, useRef, useState } from "react";
import { loadNeuropils } from "../lib/data.js";
import { Viewer } from "../lib/viewer.js";

const LABEL_STYLE = { position: "absolute", inset: 0, pointerEvents: "none" };

/**
 * Mounts a Viewer loaded with every neuropil mesh once the element nears the viewport, passes it to ``onReady``
 * when geometry is available, and pauses rendering while it is off screen. Callbacks are read through a ref so
 * parents can pass fresh closures on every render. Auto-rotating views get a button to pause the rotation unless
 * ``rotateControl`` is false.
 */
export default function Viewer3D({
  onReady,
  onHover,
  onPick,
  autoRotate = false,
  rotateControl = true,
  className = "",
  label,
  children,
}) {
  const container = useRef(null);
  const viewerRef = useRef(null);
  const callbacks = useRef({});
  const [near, setNear] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rotation, setRotation] = useState({ on: false, allowed: false });
  callbacks.current = { onReady, onHover, onPick };

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "600px" },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return undefined;
    let viewer;
    try {
      viewer = new Viewer(container.current, {
        autoRotate,
        onHover: onHover ? (hit, event) => callbacks.current.onHover?.(hit, event) : undefined,
        onPick: onPick ? (hit) => callbacks.current.onPick?.(hit) : undefined,
        onRotateChange: (on, allowed) => setRotation({ on, allowed }),
      });
    } catch {
      setError("3D view unavailable: this browser could not start WebGL.");
      setLoading(false);
      return undefined;
    }
    viewerRef.current = viewer;
    setRotation({ on: viewer.autoRotating, allowed: viewer.rotationAllowed });
    const visibility = new IntersectionObserver(([entry]) => viewer.setActive(entry.isIntersecting));
    visibility.observe(container.current);
    let cancelled = false;
    loadNeuropils()
      .then((neuropils) => {
        if (cancelled) return;
        viewer.setNeuropils(neuropils);
        callbacks.current.onReady?.(viewer, neuropils);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      visibility.disconnect();
      callbacks.current.onReady?.(null, null);
      viewerRef.current = null;
      viewer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);

  const showRotate = autoRotate && rotateControl && rotation.allowed && !loading && !error;

  return (
    <div className={`viewer ${className}`} ref={container}>
      <div role="img" aria-label={label} style={LABEL_STYLE} />
      {loading && !error && (
        <p className="viewer-status" role="status">
          Loading anatomy
        </p>
      )}
      {error && (
        <p className="viewer-status viewer-error" role="status">
          {error}
        </p>
      )}
      {children}
      {showRotate && (
        <button
          type="button"
          className="button button-field-quiet viewer-rotate"
          onClick={() => viewerRef.current?.setAutoRotate(!rotation.on)}
        >
          {rotation.on ? "Pause rotation" : "Resume rotation"}
        </button>
      )}
    </div>
  );
}
