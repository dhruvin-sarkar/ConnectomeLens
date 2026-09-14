import { useEffect, useState } from "react";
import Atlas from "./Atlas.jsx";
import Game from "./Game.jsx";
import Pathfinder from "./Pathfinder.jsx";
import { loadJSON } from "./data.js";

const REPO = "https://github.com/dhruvin-sarkar/ConnectomeLens";
const MODES = [
  { id: "atlas", label: "Dimorphism Atlas", component: Atlas },
  { id: "pathfinder", label: "Circuit Pathfinder", component: Pathfinder },
  { id: "game", label: "Guess the Neuron", component: Game },
];

function useHashMode() {
  const read = () => MODES.find((m) => `#${m.id}` === window.location.hash)?.id ?? "atlas";
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const update = () => setMode(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return mode;
}

function Headline({ summary }) {
  if (!summary) return <div className="headline headline-loading" />;
  const { classifier, nullModel } = summary;
  return (
    <dl className="headline">
      <div>
        <dt>cross-validated AUC-PR</dt>
        <dd>
          {classifier.auc_pr.toFixed(3)}
          <span>vs {classifier.baseline_auc_pr.toFixed(3)} by chance</span>
        </dd>
      </div>
      <div>
        <dt>vs {nullModel.n_trials} degree-preserving random graphs</dt>
        <dd>
          p = {nullModel.full.p_value.toFixed(3)}
          <span>no random graph matched the real wiring</span>
        </dd>
      </div>
      <div>
        <dt>graph topology features alone</dt>
        <dd>
          {nullModel.topology_only.real.toFixed(3)}
          <span>vs {nullModel.topology_only.null_mean.toFixed(3)} on random graphs</span>
        </dd>
      </div>
    </dl>
  );
}

export default function App() {
  const mode = useHashMode();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadJSON("summary.json").then(setSummary, (e) => setError(e.message));
  }, []);

  const Mode = MODES.find((m) => m.id === mode).component;

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <h1>Wired Different</h1>
          <p>
            Does the wiring of the male fruit fly's nervous system carry a signature of which cell types differ between
            the sexes? A classifier that sees only the male connectome, tested against randomized wiring.
          </p>
        </div>
        <Headline summary={summary} />
      </header>

      <nav className="tabs" aria-label="Modes">
        {MODES.map((m) => (
          <a
            key={m.id}
            href={`#${m.id}`}
            className={m.id === mode ? "active" : ""}
            aria-current={m.id === mode ? "page" : undefined}
          >
            {m.label}
          </a>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      <main>{summary && <Mode key={mode} summary={summary} />}</main>

      <footer className="footer">
        <p>
          Data: adult male <i>Drosophila</i> central nervous system connectome (male-cns v1.0) from HHMI Janelia FlyEM
          and Google Research, Berg et al., <i>Cell</i> 2026, CC-BY 4.0, accessed through neuPrint. Probabilities are
          out-of-fold: every cell type was scored by a model that never saw its label. Results are correlational and
          structural; they are not evidence of new dimorphism and say nothing directly about behavior.
        </p>
        <p>
          <a href={REPO}>Code, technical report and reproduction instructions</a>
        </p>
      </footer>
    </div>
  );
}
