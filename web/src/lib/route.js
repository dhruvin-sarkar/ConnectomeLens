import { useEffect, useState } from "react";

export const PAGES = ["findings", "atlas", "circuits", "game", "methods"];
const ALIASES = { "": "findings", pathfinder: "circuits" };

export function parseHash(hash) {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const page = ALIASES[path] ?? path;
  return { page: PAGES.includes(page) ? page : "findings", params: new URLSearchParams(query) };
}

export function href(page, params) {
  const query = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString() : "";
  return `#${page}${query ? `?${query}` : ""}`;
}

/** Current hash route; scrolls to the top when the page (not just its query) changes. */
export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute((previous) => {
        const next = parseHash(window.location.hash);
        if (next.page !== previous.page) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

/** Update the query of the current page without adding a history entry or scrolling. */
export function replaceParams(page, params) {
  const target = href(page, params);
  if (window.location.hash !== target) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}
