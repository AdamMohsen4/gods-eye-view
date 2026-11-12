import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDistance, shareText, type GameState, type GuessResponse, type LatLon } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { PanoView, type PanoViewHandle } from '../pano/PanoView.tsx';
import { ResultMap } from '../map/ResultMap.tsx';
import { GuessPanel } from '../components/GuessPanel.tsx';
import { Flag, ScoreBar, Timer, copy, fmt, settingsLine, useCountdown, useTitle } from '../components/ui.tsx';
import { ChallengeBoard } from './ChallengePage.tsx';
import { IconCheck, IconClose, IconReturn, IconShare, IconCopy } from '../components/icons.tsx';
import { refreshMe } from '../me.ts';

export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameState | null>(null);
  const [reveal, setReveal] = useState<GuessResponse | null>(null);
  const [pin, setPin] = useState<LatLon | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pano = useRef<PanoViewHandle>(null);
  const submitted = useRef(false);

  useTitle(game ? game.map.name : 'Game');

  useEffect(() => {
    // "Play again" reuses this component for the new id, so reset everything.
    let cancelled = false;
    setGame(null);
    setReveal(null);
    setPin(null);
    setError(null);
    setBusy(false);
    submitted.current = false;
    void (async () => {
      let g = await api.game(id!);
      if (g.status === 'active' && !g.current) g = await api.next(id!);
      if (!cancelled) setGame(g);
    })().catch((e) => {
      if (!cancelled) setError(errorText(e));
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const submit = useCallback(
    async (p: LatLon | null) => {
      if (!game?.current || submitted.current) return;
      submitted.current = true;
      setBusy(true);
      try {
        const r = await api.guess(game.id, p);
        setReveal(r);
        setGame({ ...game, totalScore: r.totalScore, streak: r.streak, status: r.finished ? 'finished' : 'active', rounds: [...game.rounds, r.round] });
        refreshMe();
      } catch (e) {
        submitted.current = false;
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [game],
  );

  const nextRound = useCallback(async () => {
    if (!game || busy) return;
    if (game.status === 'finished') {
      setReveal(null);
      return;
    }
    setBusy(true);
    try {
      const g = await api.next(game.id);
      setPin(null);
      submitted.current = false;
      setReveal(null);
      setGame(g);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [game, busy]);

  const left = useCountdown(!reveal ? (game?.current?.deadline ?? null) : null);
  useEffect(() => {
    if (left === 0 && !reveal && game?.current) void submit(pin);
  }, [left, reveal, game, pin, submit]);

  // Space / Enter: lock in, then continue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let focused controls handle their own keys (e.g. Enter on "Return to start").
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement) return;
      if (e.key !== ' ' && e.key !== 'Enter') return;
      // Holding the key after a guess must not skip straight past the reveal.
      if (e.repeat) return;
      if (reveal) {
        e.preventDefault();
        if (!busy) void nextRound();
      } else if (pin && game?.current && !busy) {
        e.preventDefault();
        void submit(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, pin, game, busy, submit, nextRound]);

  if (error)
    return (
      <div className="page center">
        <p role="alert">{error}</p>
        <Link className="btn" to="/">
          Home
        </Link>
      </div>
    );
  if (!game) return <div className="page center muted">Loading…</div>;
  if (game.status === 'finished' && !reveal) return <Summary game={game} />;

  const streak = game.mode === 'streak';
  const roundNo = (game.current?.index ?? reveal?.round.index ?? 0) + 1;

  return (
    <div className="play">
      {game.current && !reveal && <PanoView ref={pano} pano={game.current.pano} move={game.settings.move} />}
      {!reveal && game.current && (
        <>
          <div className="hud">
            <div className="hud-group">
              <span className="hud-cell">
                <small>Map</small>
                {game.map.name}
              </span>
              <span className="hud-cell">
                <small>{streak ? 'Streak' : 'Round'}</small>
                {streak ? game.streak : `${roundNo} / ${game.settings.rounds}`}
              </span>
              {!streak && (
                <span className="hud-cell">
                  <small>Score</small>
                  {fmt(game.totalScore)}
                </span>
              )}
            </div>
            <Timer left={left} total={game.settings.timeLimit} />
          </div>
          {game.settings.move === 'move' && (
            <button type="button" className="btn btn-glass return-btn" onClick={() => pano.current?.reset()} title="Back to where you started">
              <IconReturn size={18} /> Return to start
            </button>
          )}
          <GuessPanel pin={pin} onPin={setPin} onGuess={() => void submit(pin)} busy={busy} showCountry={streak} />
        </>
      )}
      {reveal && <RoundReveal game={game} reveal={reveal} onNext={() => void nextRound()} busy={busy} />}
    </div>
  );
}

function RoundReveal({ game, reveal, onNext, busy }: { game: GameState; reveal: GuessResponse; onNext: () => void; busy: boolean }) {
  const r = reveal.round;
  const streak = game.mode === 'streak';
  const finishText = reveal.finished ? (streak ? 'See your streak' : 'See results') : 'Next round';
  return (
    <div className="reveal">
      <ResultMap pairs={[{ truth: r.truth, guesses: [{ at: r.guess }] }]} padding={{ top: 110, bottom: 360, left: 80, right: 80 }} />
      <section className="reveal-card" aria-live="polite">
        {streak ? (
          <>
            <h2 className={`verdict ${r.correct ? 'is-ok' : 'is-bad'}`}>
              {r.correct ? <IconCheck size={26} /> : <IconClose size={26} />} {r.correct ? 'Correct' : 'Streak over'}
            </h2>
            <p className="reveal-place-line">
              It was <Flag code={r.country?.code} /> <strong>{r.country?.name ?? 'somewhere unknown'}</strong>.
            </p>
            <p className="muted">
              {r.correct
                ? `That’s ${reveal.streak} in a row.`
                : r.guessCountry
                  ? `You picked ${r.guessCountry.name}. Final streak: ${reveal.streak}.`
                  : r.timedOut
                    ? `Time ran out. Final streak: ${reveal.streak}.`
                    : `Your pin wasn’t in a country. Final streak: ${reveal.streak}.`}
            </p>
          </>
        ) : (
          <>
            <h2 className="score-big">
              {fmt(r.score)} <small>points</small>
            </h2>
            <ScoreBar score={r.score} />
            <p className="muted">
              {r.timedOut ? (
                'Time ran out before you guessed.'
              ) : (
                <>
                  Your guess was <strong>{formatDistance(r.distanceKm)}</strong> away.
                </>
              )}{' '}
              It was in <Flag code={r.country?.code} /> {r.country?.name ?? 'somewhere'}.
            </p>
          </>
        )}
        {r.credit && <p className="credit">Imagery: {r.credit}</p>}
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={busy} autoFocus data-testid="next-button">
          {finishText}
        </button>
        <span className="kbd-hint">
          {streak ? `Streak ${reveal.streak}` : `Round ${r.index + 1} of ${game.settings.rounds}`}
          <span className="kbd-only">
            {' '}
            · or press <kbd>Space</kbd>
          </span>
        </span>
      </section>
    </div>
  );
}

function Summary({ game }: { game: GameState }) {
  const nav = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const streak = game.mode === 'streak';
  const isChallenge = !!game.challengeToken;
  const shareUrl = `${location.origin}/share/${game.id}`;

  async function again() {
    if (starting) return;
    setStarting(true);
    try {
      const g = await api.startGame(game.map.slug, game.settings, streak ? 'streak' : 'classic');
      nav(`/game/${g.id}`);
    } catch (e) {
      setNote(errorText(e));
      setStarting(false);
    }
  }
  async function challenge() {
    try {
      const url = game.challengeToken
        ? `${location.origin}/challenge/${game.challengeToken}`
        : `${location.origin}/challenge/${(await api.createChallenge(game.map.slug, game.settings)).token}`;
      setNote((await copy(url)) ? 'Challenge link copied. Send it to a friend.' : url);
    } catch (e) {
      setNote(errorText(e));
    }
  }
  async function share() {
    const title = game.dailyNumber ? `Earthnow Daily #${game.dailyNumber}` : `Earthnow · ${game.map.name}`;
    const text = shareText({ title, total: game.totalScore, scores: game.rounds.map((r) => r.score), url: shareUrl });
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* fall back to copy */
      }
    }
    setNote((await copy(text)) ? 'Result copied. No spoilers in it.' : text);
  }

  return (
    <div className="summary">
      <ResultMap
        pairs={game.rounds.map((r) => ({ truth: r.truth, guesses: [{ at: r.guess }], truthLabel: String(r.index + 1) }))}
        // The card docks right on desktop and along the bottom (62% tall) on phones.
        padding={(w, h) => (w <= 820 ? { top: 90, bottom: h * 0.62 + 30, left: 40, right: 40 } : { top: 90, bottom: 60, left: 70, right: 470 })}
      />
      <aside className="summary-card">
        {streak ? (
          <h1 className="score-huge">
            {game.streak} <small>{game.streak === 1 ? 'country' : 'countries'} in a row</small>
          </h1>
        ) : (
          <h1 className="score-huge">
            {fmt(game.totalScore)} <small>/ {fmt(game.settings.rounds * 5000)}</small>
          </h1>
        )}
        <p className="facts">
          <span>{game.dailyNumber ? `Daily #${game.dailyNumber}` : isChallenge ? 'Challenge' : streak ? 'Country streak' : 'Classic'}</span>
          <span>{game.map.name}</span>
          <span>{settingsLine(game.settings)}</span>
        </p>
        <ol className="round-list">
          {game.rounds.map((r) => (
            <li key={r.index}>
              <span className="round-no">{r.index + 1}</span>
              <span className="round-place">
                <Flag code={r.country?.code} /> {r.country?.name ?? '—'}
              </span>
              {streak ? (
                <span className={`round-verdict ${r.correct ? 'ok' : 'bad'}`}>
                  {r.correct ? <><IconCheck size={18} /><span className="sr-only">Correct</span></> : <><IconClose size={16} /> {r.guessCountry?.name ?? 'no country'}</>}
                </span>
              ) : (
                <>
                  <span className="round-dist">{r.timedOut ? 'timed out' : formatDistance(r.distanceKm)}</span>
                  <span className="round-score">{fmt(r.score)}</span>
                </>
              )}
            </li>
          ))}
        </ol>
        <div className="actions">
          {!isChallenge && (
            <button type="button" className="btn btn-primary" onClick={() => void again()} disabled={starting}>
              Play again
            </button>
          )}
          {!streak && (
            <button type="button" className="btn" onClick={() => void share()}>
              <IconShare size={18} />
              Share result
            </button>
          )}
          {!streak && !game.dailyNumber && (
            <button type="button" className="btn" onClick={() => void challenge()}>
              <IconCopy size={18} />
              {isChallenge ? 'Copy challenge link' : 'Challenge a friend'}
            </button>
          )}
          <Link className="btn btn-ghost" to={`/maps/${game.map.slug}`}>
            {game.map.name}
          </Link>
        </div>
        {note && (
          <p className="note" role="status">
            {note}
          </p>
        )}
        {game.challengeToken && <ChallengeBoard token={game.challengeToken} highlight={game.id} />}
      </aside>
    </div>
  );
}
