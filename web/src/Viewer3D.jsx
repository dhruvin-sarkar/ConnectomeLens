import { useEffect, useRef, useState } from "react";
import { loadNeuropils } from "./data.js";
import { Viewer } from "./viewer.js";

/**
 * Mounts a Viewer loaded with every neuropil mesh and passes it to ``onReady`` once geometry is available.
 * Pointer callbacks are read through a ref so parents can pass fresh closures on every render.
 */
export default function Viewer3D({ onReady, onHover, onPick, className = "", children }) {
  const container = useRef(null);
  const callbacks = useRef({});
  const [error, setError] = useState(null);
  callbacks.current = { onReady, onHover, onPick };

  useEffect(() => {
    const viewer = new Viewer(container.current, {
      onHover: onHover ? (hit, event) => callbacks.current.onHover?.(hit, event) : undefined,
      onPick: onPick ? (hit) => callbacks.current.onPick?.(hit) : undefined,
    });
    let cancelled = false;
    loadNeuropils()
      .then((neuropils) => {
        if (cancelled) return;
        viewer.setNeuropils(neuropils);
        callbacks.current.onReady?.(viewer);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      callbacks.current.onReady?.(null);
      viewer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`viewer ${className}`} ref={container}>
      {error && <p className="viewer-error">{error}</p>}
      {children}
    </div>
  );
}
