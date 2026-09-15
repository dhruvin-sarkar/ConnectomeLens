import { useEffect, useRef, useState } from "react";

/** ``{ value, error }`` of a promise-returning loader, re-run when ``deps`` change. */
export function useAsync(load, deps) {
  const [state, setState] = useState({ value: null, error: null });
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setState({ value, error: null }),
      (error) => live && setState({ value: null, error: error.message }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Several loaders at once: ``{ value: [..] | null, error }``. */
export function useAll(loaders) {
  return useAsync(() => Promise.all(loaders.map((load) => load())), []);
}

/** Content-box size of an element, updated on resize. */
export function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** True once the element has come within ``margin`` of the viewport (or while it is visible, when ``once`` is false). */
export function useInView(ref, { margin = "0px", threshold = 0, once = true } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin: margin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, threshold, once]);
  return inView;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Progress from 0 to 1 over ``duration`` ms once ``start`` becomes true; jumps to 1 when motion is reduced. */
export function useProgress(start, duration, key) {
  const [t, setT] = useState(0);
  const frame = useRef(0);
  useEffect(() => {
    if (!start) return undefined;
    if (prefersReducedMotion()) {
      setT(1);
      return undefined;
    }
    setT(0);
    const begin = performance.now();
    const tick = (now) => {
      const value = Math.min(1, (now - begin) / duration);
      setT(value);
      if (value < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [start, duration, key]);
  return t;
}

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Largest posterior coordinate of the brain neuropils, used to tell whether a skeleton reaches the nerve cord. */
export function brainDepth(neuropils) {
  return Math.max(...neuropils.filter((n) => n.region === "brain").map((n) => n.geometry.boundingBox.max.z));
}

export const reachesCord = (skeleton, neuropils) =>
  Math.max(...skeleton.points.filter((_, i) => i % 3 === 2)) > brainDepth(neuropils);
