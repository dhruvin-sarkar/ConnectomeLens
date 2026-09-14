import { useEffect, useState } from "react";

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

/** Largest posterior coordinate of the brain neuropils, used to tell whether a skeleton reaches the nerve cord. */
export function brainDepth(neuropils) {
  return Math.max(...neuropils.filter((n) => n.region === "brain").map((n) => n.geometry.boundingBox.max.z));
}

export const reachesCord = (skeleton, neuropils) =>
  Math.max(...skeleton.points.filter((_, i) => i % 3 === 2)) > brainDepth(neuropils);
