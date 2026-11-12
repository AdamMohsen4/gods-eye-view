import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChallengeInfo, LeaderboardRow } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { Flag, fmt, plural, settingsLine, useTitle } from '../components/ui.tsx';
import { serverNow } from '../hub.ts';
import { useMe } from '../me.ts';

export function ChallengeBoard({ token, highlight }: { token: string; highlight?: string }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [you, setYou] = useState<LeaderboardRow | null>(null);
  useEffect(() => {
    void api
      .challengeLeaderboard(token)
      .then((r) => {
        setRows(r.rows);
        setYou(r.you);
      })
      .catch(() => setRows([]));
  }, [token]);
  if (!rows) return null;
  return (
    <section className="board">
      <h3>Leaderboard</h3>
      <Board rows={rows} highlight={(r) => r.gameId === highlight || r.userId === you?.userId} />
      {you && you.rank > rows.length && <p className="muted">You are #{you.rank}.</p>}
    </section>
  );
}

export function Board({ rows, unit, highlight }: { rows: LeaderboardRow[]; unit?: string; highlight?: (r: LeaderboardRow) => boolean }) {
  if (!rows.length) return <p className="muted">No one on the board yet.</p>;
  return (
    <ol className="board-list">
      {rows.map((r) => (
        <li key={`${r.userId}-${r.rank}`} className={highlight?.(r) ? 'me' : ''}>
          <span className="rank">{r.rank}</span>
          <span className="who">
            <Flag code={r.country} /> {r.displayName}
          </span>
          <span className="pts">
            {fmt(r.score)}
            {unit ? ` ${unit}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** " · next one in 6 h 12 min": the daily resets at 00:00 UTC. */
function NextDaily() {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 30_000);
    return () => clearInterval(id);
  }, []);
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const mins = Math.max(1, Math.ceil((next - now) / 60_000));
  const h = Math.floor(mins / 60);
  return <> · next one in {h ? `${h} h ${mins % 60} min` : `${mins} min`}</>;
}

/** Landing for a challenge link, and for the daily (`daily` prop). */
export function ChallengePage({ daily = false }: { daily?: boolean }) {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ChallengeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const me = useMe();
  useTitle(daily ? 'Daily' : 'Challenge');

  useEffect(() => {
    // /daily and /challenge/:token share this component; start clean on every switch.
    let live = true;
    setInfo(null);
    setError(null);
    setBusy(false);
    (daily ? api.daily() : api.challenge(token!))
      .then((i) => live && setInfo(i))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [daily, token]);

  async function play() {
    setBusy(true);
    try {
      const g = await api.playChallenge(info!.token);
      nav(`/game/${g.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (error)
    return (
      <div className="page center">
        <p role="alert">{error}</p>
        <Link to="/daily" className="btn">
          Today’s daily
        </Link>
      </div>
    );
  if (!info) return <div className="page center muted">Loading…</div>;

  return (
    <div className="page narrow">
      <h1 className="display">{info.dailyNumber ? 'Five places. Same for everyone.' : `${info.creatorName ?? 'A friend'} challenged you`}</h1>
      <p className="facts">
        <span>{info.dailyNumber ? `Daily #${info.dailyNumber}` : `${info.map.name}, five rounds`}</span>
        {info.dailyNumber && <span>{info.map.name}</span>}
        <span>{settingsLine(info.settings)}</span>
        <span>{plural(info.plays, 'player')} so far</span>
      </p>
      {daily && me && (
        <p className="streak-line">
          Daily streak <strong>{me.dailyStreak.current}</strong> · best {me.dailyStreak.best}
          <NextDaily />
        </p>
      )}
      <div className="actions">
        {info.finished ? (
          <Link className="btn btn-primary" to={`/game/${info.gameId}`}>
            See your result
          </Link>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void play()} disabled={busy} data-testid="play-challenge">
            {info.gameId ? 'Continue' : 'Play'}
          </button>
        )}
      </div>
      <p className="muted small">One attempt. The leaderboard opens once you finish.</p>
      {info.finished && <ChallengeBoard token={info.token} />}
    </div>
  );
}
