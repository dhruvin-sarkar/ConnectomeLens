import { Component, Suspense, lazy, useEffect, useRef, useState } from "react";
import { ErrorNote, REPO, REPORT_PDF } from "./components/ui.jsx";
import {
  loadCandidates,
  loadDiagnostics,
  loadGame,
  loadMap,
  loadNeuropils,
  loadRoutes,
  loadSummary,
  loadTypes,
} from "./lib/data.js";
import { href, useRoute } from "./lib/route.js";

const Findings = lazy(() => import("./pages/Findings.jsx"));
const Atlas = lazy(() => import("./pages/Atlas.jsx"));
const Circuits = lazy(() => import("./pages/Circuits.jsx"));
const Game = lazy(() => import("./pages/Game.jsx"));
const Methods = lazy(() => import("./pages/Methods.jsx"));

// ``data`` lists the loaders each page needs before its first render, started alongside the page's code.
const PAGES = {
  findings: {
    component: Findings,
    label: "Findings",
    title: "Wired Different",
    data: [loadSummary, loadDiagnostics, loadTypes, loadMap, loadRoutes, loadCandidates],
  },
  atlas: {
    component: Atlas,
    label: "Atlas",
    title: "Atlas | Wired Different",
    data: [loadTypes, loadCandidates, loadNeuropils],
  },
  circuits: {
    component: Circuits,
    label: "Circuits",
    title: "Circuits | Wired Different",
    data: [loadRoutes, loadTypes],
  },
  game: {
    component: Game,
    label: "Guess the Neuron",
    title: "Guess the Neuron | Wired Different",
    data: [loadGame, loadTypes],
  },
  methods: {
    component: Methods,
    label: "Methods",
    title: "Methods | Wired Different",
    data: [loadSummary, loadDiagnostics, loadRoutes, loadCandidates],
  },
};

const TOOLS = new Set(["atlas", "circuits"]);

function Nav({ page }) {
  const nav = useRef(null);

  // On narrow screens the links scroll sideways, so keep the current one in view.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [page]);

  return (
    <header className="nav">
      <a className="wordmark" href={href("findings")} aria-label="Wired Different, findings">
        Wired Different
      </a>
      <nav aria-label="Sections" ref={nav}>
        <ul>
          {Object.entries(PAGES).map(([id, { label }]) => (
            <li key={id}>
              <a href={href(id)} aria-current={id === page ? "page" : undefined}>
                {label}
              </a>
            </li>
          ))}
          <li className="nav-external">
            <a href={REPO}>Code</a>
          </li>
        </ul>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <p className="footer-title">Wired Different</p>
          <p>
            A wiring-only classifier for cell types annotated dimorphic or male-specific in the male{" "}
            <i>Drosophila</i> connectome, tested against 500 degree-preserving randomized graphs.
          </p>
        </div>
        <div>
          <p className="footer-heading">Data</p>
          <p>
            Male adult <i>Drosophila</i> central nervous system connectome (male-cns v1.0) from HHMI Janelia FlyEM and
            Google Research, released under CC-BY 4.0 and accessed through neuPrint. Berg et al., <i>Cell</i> 2026,{" "}
            <a href="https://doi.org/10.1016/j.cell.2026.08.015">doi:10.1016/j.cell.2026.08.015</a>.
          </p>
        </div>
        <div>
          <p className="footer-heading">This project</p>
          <ul>
            <li>
              <a href={REPORT_PDF}>Technical report (PDF)</a>
            </li>
            <li>
              <a href={REPO}>Source code and reproduction</a>
            </li>
            <li>
              <a href={href("methods")}>Methods and full results</a>
            </li>
          </ul>
        </div>
      </div>
      <p className="footer-note">
        Probabilities are out-of-fold: every cell type was scored by a model that never saw its label. Results are
        correlational and structural. Candidates are not evidence of new dimorphism, and nothing here has been peer
        reviewed. Code released under the MIT License.
      </p>
    </footer>
  );
}

/** Shows a plain message in place of a page that fails to render. */
class PageBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="chapter">
        <ErrorNote>
          This page could not be displayed. Reload to try again, or go back to{" "}
          <a href={href("findings")}>the findings</a>.
        </ErrorNote>
      </div>
    );
  }
}

/** Moves focus to the main landmark without touching the hash, which the router reads as a page. */
function skipToMain(event) {
  event.preventDefault();
  const main = document.getElementById("main");
  main?.focus();
  main?.scrollIntoView({ block: "start" });
}

export default function App() {
  const { page, params } = useRoute();
  const { component: Page, title, data } = PAGES[page];
  const main = useRef(null);
  const firstPage = useRef(page);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    for (const load of data) load();
  }, [data]);

  useEffect(() => {
    if (page === firstPage.current) return;
    firstPage.current = null;
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    setAnnouncement(PAGES[page].title);
  }, [page]);

  return (
    <div className={`app app-${page}`}>
      <a className="skip-link" href="#main" onClick={skipToMain}>
        Skip to content
      </a>
      <Nav page={page} />
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        style={{ outline: "none" }}
        className={TOOLS.has(page) ? "main-tool" : "main-page"}
      >
        <PageBoundary key={page}>
          <Suspense fallback={<p className="loading loading-page">Loading</p>}>
            <Page params={params} />
          </Suspense>
        </PageBoundary>
      </main>
      {!TOOLS.has(page) && <Footer />}
    </div>
  );
}
