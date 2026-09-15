import { useEffect, useRef, useState } from "react";
import { ErrorNote, LabelMark, Loading, TypeLink } from "../components/ui.jsx";
import { SkeletonPlate } from "../figures/Neurons.jsx";
import { loadGame, loadTypes } from "../lib/data.js";
import { LABELS, SEX_RELATED, neuropilName, probability, superclassName } from "../lib/format.js";
import { prefersReducedMotion, useAll } from "../lib/hooks.js";
import { href } from "../lib/route.js";

const ROUNDS = 10;
const LETTERS = ["A", "B"];

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ten pairs in random order and random left/right placement, preferring pairs not shown in earlier games. */
function drawRounds(pool, seen) {
  const fresh = shuffle(pool.filter((pair) => !seen.has(pair.sexRelated)));
  const repeats = shuffle(pool.filter((pair) => seen.has(pair.sexRelated)));
  if (fresh.length < ROUNDS) seen.clear();
  const picked = [...fresh, ...repeats].slice(0, ROUNDS);
  picked.forEach((pair) => seen.add(pair.sexRelated));
  return picked.map((pair) => shuffle([pair.sexRelated, pair.isomorphic]));
}

/** Probability as it reads in a sentence. */
function spoken(p) {
  if (p >= 0.995) return "above 0.99";
  if (p < 0.005) return "below 0.01";
  return p.toFixed(2);
}

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

function Intro({ pool, types, onStart }) {
  const inPool = new Set(pool.flatMap((pair) => [pair.sexRelated, pair.isomorphic]));
  const sample = types.list.find((t) => t.b && SEX_RELATED.has(t.l) && !inPool.has(t.t));
  return (
    <section className="game-intro">
      <div className="game-intro-copy">
        <h1 className="game-title">Guess the Neuron</h1>
        <p className="game-deck">
          Two neurons from the male fly&apos;s nervous system, reconstructed synapse by synapse. One belongs to a cell
          type Janelia annotates as dimorphic or male-specific. Can you tell which from its shape?
        </p>
        <ol className="game-steps">
          <li>
            <strong>Compare the pair.</strong> Both types come from the same superclass and have the largest share of
            their synapses in the same neuropil, so location will not give it away. Drag either neuron to rotate it.
          </li>
          <li>
            <strong>Pick the sex-related one.</strong> The other is annotated isomorphic.
          </li>
          <li>
            <strong>See the answer</strong> with the classifier&apos;s probability for both types, and whether it would
            have picked correctly.
          </li>
        </ol>
        <div className="game-start">
          <button type="button" className="button button-large" onClick={onStart}>
            Play {ROUNDS} rounds
          </button>
          <p className="game-keys">
            Keyboard: <kbd>A</kbd> or <kbd>B</kbd> to pick, <kbd>Enter</kbd> for the next round
          </p>
        </div>
      </div>
      {sample && (
        <figure className="game-intro-figure">
          <SkeletonPlate
            bodyId={sample.b}
            label={sample.l}
            className="game-intro-plate"
            description={`Rotating reconstruction of a ${sample.t} neuron`}
          />
          <figcaption>
            One neuron of <TypeLink name={sample.t} />, annotated <LabelMark label={sample.l} />. It is not in the game,
            where both neurons are drawn in white.
          </figcaption>
        </figure>
      )}
    </section>
  );
}

function Pips({ results, round }) {
  return (
    <ol className="pips" aria-hidden="true">
      {Array.from({ length: ROUNDS }, (_, i) => {
        let state = "upcoming";
        if (i < results.length) state = results[i].correct ? "right" : "wrong";
        else if (i === round) state = "current";
        return <li key={i} className={`pip pip-${state}`} />;
      })}
    </ol>
  );
}

function Tally({ score, modelScore }) {
  return (
    <dl className="game-tally">
      <div>
        <dt>You</dt>
        <dd>{score}</dd>
      </div>
      <div className="game-tally-model">
        <dt>Classifier</dt>
        <dd>{modelScore}</dd>
      </div>
    </dl>
  );
}

function Contender({ letter, type, revealed, chosen, onChoose }) {
  const answer = SEX_RELATED.has(type.l);
  const classes = ["contender"];
  if (revealed) classes.push(answer ? `is-answer tone-${type.l}` : "is-other");
  if (chosen) classes.push(answer ? "is-chosen-right" : "is-chosen-wrong");
  return (
    <article className={classes.join(" ")} aria-label={`Neuron ${letter}`}>
      <SkeletonPlate bodyId={type.b} className="contender-plate" description={`Neuron ${letter}, drag to rotate`}>
        <span className="contender-letter" aria-hidden="true">
          {letter}
        </span>
        {chosen && <span className="contender-pick">Your pick</span>}
      </SkeletonPlate>
      <div className="contender-foot">
        {revealed ? (
          <div className="contender-reveal">
            <p className="contender-name">
              <TypeLink name={type.t} />
              <LabelMark label={type.l} />
            </p>
            <p className="contender-p">
              <span className="contender-p-label">Classifier probability</span>
              <span className="contender-p-track" aria-hidden="true">
                <span style={{ width: `${Math.max(1, type.p * 100)}%` }} />
              </span>
              <span className="contender-p-value">{probability(type.p)}</span>
            </p>
          </div>
        ) : (
          <button type="button" className="contender-choose" onClick={onChoose}>
            Pick neuron {letter}
            <kbd aria-hidden="true">{letter}</kbd>
          </button>
        )}
      </div>
    </article>
  );
}

function verdictText(pair, answer, correct, modelCorrect) {
  const a = pair[answer];
  const o = pair[1 - answer];
  const annotation = `Janelia annotates ${a.t} as ${LABELS[a.l]} and ${o.t} as isomorphic.`;
  const scores = modelCorrect
    ? `${a.t} ${spoken(a.p)} and ${o.t} ${spoken(o.p)}`
    : `${o.t} ${spoken(o.p)} and ${a.t} only ${spoken(a.p)}`;
  let model;
  if (correct && modelCorrect) model = `The classifier agrees, giving ${scores}.`;
  else if (correct) model = `You beat the classifier on this pair: it gives ${scores}.`;
  else if (modelCorrect) model = `The classifier got this one, giving ${scores}.`;
  else model = `The classifier would have picked wrong too: it gives ${scores}.`;
  return `${annotation} ${model}`;
}

function Finish({ rounds, results, types, onRestart }) {
  const [copied, setCopied] = useState(null);
  const heading = useRef(null);
  const score = results.filter((r) => r.correct).length;
  const modelScore = results.filter((r) => r.modelCorrect).length;
  const link = `${window.location.origin}${window.location.pathname}#game`;
  const message = `I scored ${score}/${ROUNDS} on Wired Different, guessing which fly neurons are sex-related. The wiring classifier scored ${modelScore}/${ROUNDS}. Can you beat me?`;
  const text = `${message} ${link}`;
  const canShare = typeof navigator.share === "function";

  let title = "The classifier wins this time";
  if (score > modelScore) title = "You beat the classifier";
  else if (score === modelScore) title = "A tie with the classifier";

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <section className="game-end">
      <div className="game-end-main">
        <h1 className="game-end-title" ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <dl className="final-board">
          <div className="final-you">
            <dt>You</dt>
            <dd>
              {score}
              <span> of {ROUNDS}</span>
            </dd>
          </div>
          <div className="final-model">
            <dt>Classifier</dt>
            <dd>
              {modelScore}
              <span> of {ROUNDS}</span>
            </dd>
          </div>
        </dl>
        <p className="game-end-note">
          On each pair the classifier picks the type it gives the higher probability. It learned from the whole wiring
          diagram; you had one neuron&apos;s shape.
        </p>
        <div className="share">
          <p className="share-text">{text}</p>
          <div className="share-actions">
            <button type="button" className="button" onClick={async () => setCopied(await copyText(text))}>
              {copied ? "Copied" : "Copy result"}
            </button>
            {canShare && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => navigator.share({ title: "Guess the Neuron", text: message, url: link }).catch(() => {})}
              >
                Share
              </button>
            )}
            <button type="button" className="button button-quiet" onClick={onRestart}>
              Play again
            </button>
          </div>
          <p className="share-status" role="status">
            {copied === false && "Copying is blocked in this browser. Select the text above instead."}
          </p>
        </div>
      </div>
      <div className="recap">
        <h2 className="recap-title" id="recap-title">
          Round by round
        </h2>
        <div className="recap-scroll">
          <table className="recap-table" aria-labelledby="recap-title">
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Sex-related</th>
                <th scope="col">Isomorphic</th>
                <th scope="col">You</th>
                <th scope="col">Classifier</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((pair, i) => {
                const [answer, other] = pair
                  .map((name) => types.byName.get(name))
                  .sort((x, y) => SEX_RELATED.has(y.l) - SEX_RELATED.has(x.l));
                const { correct, modelCorrect } = results[i];
                return (
                  <tr key={pair.join("-")}>
                    <td className="recap-round">{i + 1}</td>
                    {[answer, other].map((t) => (
                      <td key={t.t}>
                        <span className="recap-type">
                          <span className={`dot ${t.l}`} title={LABELS[t.l]} />
                          <TypeLink name={t.t} />
                          <span className="recap-p">{probability(t.p)}</span>
                        </span>
                      </td>
                    ))}
                    <td className={correct ? "recap-right" : "recap-wrong"}>{correct ? "Right" : "Wrong"}</td>
                    <td className={modelCorrect ? "recap-right" : "recap-wrong"}>{modelCorrect ? "Right" : "Wrong"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="recap-note">
          Dots show Janelia&apos;s annotation: green for male-specific, teal for dimorphic, grey for isomorphic. Magenta
          numbers are the classifier&apos;s probabilities. Open any type in the <a href={href("atlas")}>atlas</a> to see
          how it was scored.
        </p>
      </div>
    </section>
  );
}

export default function Game() {
  const data = useAll([loadGame, loadTypes]);
  const [rounds, setRounds] = useState(null);
  const [round, setRound] = useState(0);
  const [choice, setChoice] = useState(null);
  const [results, setResults] = useState([]);
  const seen = useRef(new Set());
  const prompt = useRef(null);

  const pool = data.value?.[0];
  const types = data.value?.[1];
  const pair = rounds && round < ROUNDS ? rounds[round].map((name) => types.byName.get(name)) : null;
  const answer = pair ? pair.findIndex((t) => SEX_RELATED.has(t.l)) : -1;
  const revealed = choice !== null;

  const start = () => {
    setRounds(drawRounds(pool, seen.current));
    setRound(0);
    setChoice(null);
    setResults([]);
    window.scrollTo({ top: 0 });
  };

  const guess = (i) => {
    if (revealed || !pair) return;
    const modelPick = pair[0].p > pair[1].p ? 0 : 1;
    setChoice(i);
    setResults((r) => [...r, { choice: i, correct: i === answer, modelCorrect: modelPick === answer }]);
  };

  const next = () => {
    setRound((r) => r + 1);
    setChoice(null);
  };

  useEffect(() => {
    if (!rounds) return;
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    prompt.current?.focus({ preventScroll: true });
  }, [rounds, round]);

  useEffect(() => {
    if (!pair) return undefined;
    const onKey = (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (!revealed && (key === "a" || key === "b")) guess(key === "a" ? 0 : 1);
      else if (revealed && event.key === "Enter" && event.target.tagName !== "BUTTON" && event.target.tagName !== "A") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (data.error) {
    return (
      <div className="game">
        <ErrorNote>{data.error}</ErrorNote>
      </div>
    );
  }
  if (!data.value) {
    return (
      <div className="game">
        <Loading>Loading the game</Loading>
      </div>
    );
  }

  if (!rounds) {
    return (
      <div className="game">
        <Intro pool={pool} types={types} onStart={start} />
      </div>
    );
  }

  if (round === ROUNDS) {
    return (
      <div className="game">
        <Finish rounds={rounds} results={results} types={types} onRestart={start} />
      </div>
    );
  }

  const score = results.filter((r) => r.correct).length;
  const modelScore = results.filter((r) => r.modelCorrect).length;
  const dominant = pair[0].np[0]?.[0];
  const correct = choice === answer;
  const modelCorrect = results[round]?.modelCorrect;
  let verdictState = "is-waiting";
  if (revealed) verdictState = correct ? "is-right" : "is-wrong";

  return (
    <div className="game game-play">
      <div className="game-bar">
        <p className="game-progress">
          Round <strong>{round + 1}</strong> of {ROUNDS}
        </p>
        <Pips results={results} round={round} />
        <Tally score={score} modelScore={modelScore} />
      </div>
      <div className="game-question">
        <h1 className="game-prompt" ref={prompt} tabIndex={-1}>
          Which neuron belongs to a sex-related type?
        </h1>
        <p className="game-context">
          Both are {superclassName(pair[0].s)} neurons with the largest share of their synapses in the{" "}
          {neuropilName(dominant) ?? dominant}.
        </p>
      </div>
      <div className="duel">
        {pair.map((type, i) => (
          <Contender
            key={`${round}-${type.t}`}
            letter={LETTERS[i]}
            type={type}
            revealed={revealed}
            chosen={choice === i}
            onChoose={() => guess(i)}
          />
        ))}
      </div>
      <div className={`game-verdict ${verdictState}`} aria-live="polite">
        {revealed ? (
          <>
            <div className="verdict-copy">
              <p className="verdict-title">{correct ? "Right" : "Not this time"}</p>
              <p className="verdict-body">{verdictText(pair, answer, correct, modelCorrect)}</p>
            </div>
            <button type="button" className="button button-large verdict-next" onClick={next} autoFocus>
              {round + 1 === ROUNDS ? "See your score" : "Next round"}
              <kbd aria-hidden="true">Enter</kbd>
            </button>
          </>
        ) : (
          <p className="verdict-hint">
            Sex-related means Janelia annotates the type as male-specific or dimorphic. Drag a neuron to rotate it, then
            pick one<span className="verdict-keys"> with its button or by pressing <kbd>A</kbd> or <kbd>B</kbd></span>.
          </p>
        )}
      </div>
    </div>
  );
}
