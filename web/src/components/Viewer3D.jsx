import { useEffect, useRef, useState } from "react";
import { loadNeuropils } from "../lib/data.js";
import { Viewer } from "../lib/viewer.js";

/**
 * Mounts a Viewer loaded with every neuropil mesh once the element nears the viewport, passes it to ``onReady``
 * when geometry is available, and pauses rendering while it is off screen. Callbacks are read through a ref so
 * parents can pass fresh closures on every render.
 */
export default function Viewer3D({ onReady, onHover, onPick, autoRotate = false, className = "", label, children }) {
  const container = useRef(null);
  const callbacks = useRef({});
  const [near, setNear] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  callbacks.current = { onReady, onHover, onPick };

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: "600px" });
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
      });
    } catch {
      setError("3D view unavailable: this browser could not start WebGL.");
      setLoading(false);
      return undefined;
    }
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
      viewer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);

  return (
    <div className={`viewer ${className}`} ref={container} role="img" aria-label={label}>
      {loading && !error && <p className="viewer-status">Loading anatomy</p>}
      {error && <p className="viewer-status viewer-error">{error}</p>}
      {children}
    </div>
  );
}
