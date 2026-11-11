import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDistance, shareText, type GameState, type GuessResponse, type LatLon } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { PanoView, type PanoViewHandle } from '../pano/PanoView.tsx';
import { ResultMap } from '../map/ResultMap.tsx';
import { GuessPanel } from '../components/GuessPanel.tsx';
import { Flag, ScoreBar, Timer, copy, fmt, settingsLine, useCountdown, useTitle } from '../components/ui.tsx';
import { ChallengeBoard } from './ChallengePage.tsx';
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
    let cancelled = false;
    setGame(null);
    setReveal(null);
    void (async () => {
      let g = await api.game(id!);
      if (g.status === 'active' && !g.current) g = await api.next(id!);
      if (!cancelled) setGame(g);
    })().catch((e) => setError(errorText(e)));
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
    if (!game) return;
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
  }, [game]);

  const left = useCountdown(!reveal ? (game?.current?.deadline ?? null) : null);
  useEffect(() => {
    if (left === 0 && !reveal && game?.current) void submit(pin);
  }, [left, reveal, game, pin, submit]);

  // Space / Enter: lock in, then continue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (reveal) {
        e.preventDefault();
        void nextRound();
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
              ⟲ Return to start
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
      <ResultMap pairs={[{ truth: r.truth, guesses: [{ at: r.guess }] }]} padding={{ top: 80, bottom: 360, left: 60, right: 60 }} />
      <section className="reveal-card" aria-live="polite">
        {streak ? (
          <>
            <p className="eyebrow">{r.correct ? 'Correct' : 'Streak over'}</p>
            <h2>
              <Flag code={r.country?.code} /> {r.country?.name ?? 'Unknown'}
            </h2>
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
            <p className="eyebrow">
              Round {r.index + 1} of {game.settings.rounds}
            </p>
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
        <span className="kbd-hint">or press Space</span>
      </section>
    </div>
  );
}

function Summary({ game }: { game: GameState }) {
  const nav = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  const streak = game.mode === 'streak';
  const isChallenge = !!game.challengeToken;
  const shareUrl = `${location.origin}/share/${game.id}`;

  async function again() {
    const g = await api.startGame(game.map.slug, game.settings, streak ? 'streak' : 'classic');
    nav(`/game/${g.id}`);
  }
  async function challenge() {
    const url = game.challengeToken
      ? `${location.origin}/challenge/${game.challengeToken}`
      : `${location.origin}/challenge/${(await api.createChallenge(game.map.slug, game.settings)).token}`;
    setNote((await copy(url)) ? 'Challenge link copied. Send it to a friend.' : url);
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
        padding={{ top: 60, bottom: 60, left: 60, right: 460 }}
      />
      <aside className="summary-card">
        <p className="eyebrow">
          {game.dailyNumber ? `Daily #${game.dailyNumber}` : isChallenge ? 'Challenge' : streak ? 'Country streak' : 'Game over'} · {game.map.name}
        </p>
        {streak ? (
          <h1 className="score-huge">
            {game.streak} <small>{game.streak === 1 ? 'country' : 'countries'} in a row</small>
          </h1>
        ) : (
          <h1 className="score-huge">
            {fmt(game.totalScore)} <small>/ {fmt(game.settings.rounds * 5000)}</small>
          </h1>
        )}
        <p className="muted">{settingsLine(game.settings)}</p>
        <ol className="round-list">
          {game.rounds.map((r) => (
            <li key={r.index}>
              <span className="round-no">{r.index + 1}</span>
              <span className="round-place">
                <Flag code={r.country?.code} /> {r.country?.name ?? '—'}
              </span>
              {streak ? (
                <span className={r.correct ? 'ok' : 'bad'}>{r.correct ? '✓' : `✕ ${r.guessCountry?.name ?? 'no country'}`}</span>
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
            <button type="button" className="btn btn-primary" onClick={() => void again()}>
              Play again
            </button>
          )}
          {!streak && (
            <button type="button" className="btn" onClick={() => void share()}>
              Share result
            </button>
          )}
          {!streak && !game.dailyNumber && (
            <button type="button" className="btn" onClick={() => void challenge()}>
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
