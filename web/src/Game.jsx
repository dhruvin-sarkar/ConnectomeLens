import { useEffect, useState } from "react";
import Viewer3D from "./Viewer3D.jsx";
import { loadJSON, loadNeuropils, loadSkeleton, loadTypes } from "./data.js";
import { LABELS, SEX_RELATED, probability, superclassName } from "./format.js";
import { reachesCord, useAsync } from "./hooks.js";
import { VIEWS } from "./viewer.js";

const ROUNDS = 10;
const CONTEXT = [0.55, 0.57, 0.66];
const NEURON_COLOR = [0.55, 0.92, 1.0];

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const drawRounds = (pool) =>
  shuffle(pool)
    .slice(0, ROUNDS)
    .map((pair) => shuffle([pair.sexRelated, pair.isomorphic]));

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function Contender({ letter, type, revealed, chosen, correct }) {
  const neuropils = useAsync(loadNeuropils, []);
  const [viewer, setViewer] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!viewer || !neuropils.value) return;
    let live = true;
    viewer.clearSkeletons();
    loadSkeleton(type.b).then(
      (skeleton) => {
        if (!live) return;
        const cord = reachesCord(skeleton, neuropils.value);
        viewer.styleNeuropils((entry) => ({
          color: CONTEXT,
          opacity: 0.07,
          visible: entry.region === "brain" || cord,
          pickable: false,
        }));
        const lines = viewer.setSkeletons([{ skeleton, color: NEURON_COLOR, width: 1.8 }]);
        viewer.fit(lines, cord ? VIEWS.side : VIEWS.front, 1.35);
      },
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [viewer, neuropils.value, type.b]);

  const verdict = revealed && chosen ? (correct ? "correct" : "wrong") : "";
  return (
    <article className={`contender ${verdict}`}>
      <div className="stage">
        <Viewer3D onReady={setViewer} />
        {(error || neuropils.error) && <p className="overlay top-left error">{error ?? neuropils.error}</p>}
      </div>
      <footer>
        <span className="letter">
          Neuron {letter}
          {chosen && <span className="note"> · your pick</span>}
        </span>
        {revealed ? (
          <>
            <span>
              <span className={`dot ${type.l}`} /> <strong>{type.t}</strong>, annotated {LABELS[type.l]}
            </span>
            <span className="note">Classifier's out-of-fold probability of sex-related: {probability(type.p)}</span>
          </>
        ) : (
          <span className="note">Identity hidden until you choose.</span>
        )}
      </footer>
    </article>
  );
}

export default function Game() {
  const pool = useAsync(() => loadJSON("game.json"), []);
  const types = useAsync(loadTypes, []);
  const [rounds, setRounds] = useState(null);
  const [round, setRound] = useState(0);
  const [choice, setChoice] = useState(null);
  const [results, setResults] = useState([]);
  const [copied, setCopied] = useState(null);

  const loadError = pool.error ?? types.error;
  const ready = pool.value && types.value;

  const start = () => {
    setRounds(drawRounds(pool.value));
    setRound(0);
    setChoice(null);
    setResults([]);
    setCopied(null);
  };

  if (loadError) return <p className="error">{loadError}</p>;

  if (!rounds) {
    return (
      <section className="panel intro">
        <h2>Guess the Neuron</h2>
        <p>
          Each round shows two real neurons from the male fly's central nervous system, reconstructed from electron
          microscopy. One belongs to a cell type that Janelia annotates as sexually dimorphic or male-specific. The other
          belongs to an isomorphic type from the same superclass, with most of its synapses in the same neuropil. Pick the
          sex-related one.
        </p>
        <p className="note">
          After each guess you see both identities and the classifier's own out-of-fold probability for each type. Scores
          stay in your browser.
        </p>
        <button className="primary" onClick={start} disabled={!ready}>
          {ready ? `Start ${ROUNDS} rounds` : "Loading…"}
        </button>
      </section>
    );
  }

  const score = results.filter((r) => r.correct).length;
  const modelScore = results.filter((r) => r.modelCorrect).length;

  if (round === ROUNDS) {
    const link = `${window.location.origin}${window.location.pathname}#game`;
    const text = `I scored ${score}/${ROUNDS} on Wired Different — the fly brain sex classifier. Can you beat me? ${link}`;
    return (
      <section className="panel intro">
        <h2>Your score</h2>
        <div className="score">
          {score}/{ROUNDS}
        </div>
        <p style={{ marginTop: 12 }}>
          On the same rounds, choosing whichever neuron's type had the higher classifier probability would have scored{" "}
          {modelScore}/{ROUNDS}.
        </p>
        <p className="share-text">{text}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="primary" onClick={async () => setCopied(await copyText(text))}>
            {copied ? "Copied" : "Copy my score"}
          </button>
          <button className="secondary" onClick={start}>
            Play again
          </button>
        </div>
        {copied === false && <p className="note">Copying is blocked here; select the text above instead.</p>}
      </section>
    );
  }

  const pair = rounds[round].map((name) => types.value.byName.get(name));
  const answer = pair.findIndex((t) => SEX_RELATED.has(t.l));
  const revealed = choice !== null;
  const dominant = pair[0].np[0]?.[0];

  const guess = (i) => {
    const modelPick = pair[0].p >= pair[1].p ? 0 : 1;
    setChoice(i);
    setResults([...results, { correct: i === answer, modelCorrect: modelPick === answer }]);
  };

  const next = () => {
    setRound(round + 1);
    setChoice(null);
  };

  return (
    <div className="game">
      <div className="game-bar">
        <span className="progress">
          Round {round + 1}/{ROUNDS} · score {score}
        </span>
        <span className="note">
          Both are {superclassName(pair[0].s)} neurons with most synapses in {dominant}. Which one is sex-related?
        </span>
      </div>
      <div className="duel">
        {pair.map((type, i) => (
          <Contender
            key={i}
            letter={"AB"[i]}
            type={type}
            revealed={revealed}
            chosen={choice === i}
            correct={i === answer}
          />
        ))}
      </div>
      <div className="game-bar">
        {revealed ? (
          <>
            <span className={`verdict ${choice === answer ? "correct" : "wrong"}`}>
              {choice === answer ? "Correct." : "Not this time."} Neuron {"AB"[answer]} is {LABELS[pair[answer].l]}.
            </span>
            <button className="primary" onClick={next}>
              {round + 1 === ROUNDS ? "See score" : "Next round"}
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => guess(0)}>
              Neuron A is sex-related
            </button>
            <button className="primary" onClick={() => guess(1)}>
              Neuron B is sex-related
            </button>
          </>
        )}
      </div>
    </div>
  );
}
