import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChallengeInfo, LeaderboardRow } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { Flag, fmt, settingsLine, useTitle } from '../components/ui.tsx';
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
    (daily ? api.daily() : api.challenge(token!)).then(setInfo).catch((e) => setError(errorText(e)));
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
      <p className="eyebrow">{info.dailyNumber ? `Daily #${info.dailyNumber} · ${info.date}` : `Challenge from ${info.creatorName ?? 'a friend'}`}</p>
      <h1 className="display">{info.dailyNumber ? 'Five places. Same for everyone.' : `${info.map.name}, five rounds`}</h1>
      <p className="lead">
        {info.map.name} · {settingsLine(info.settings)} · {fmt(info.plays)} {info.plays === 1 ? 'player' : 'players'} so far
      </p>
      {daily && me && (
        <p className="streak-line">
          Daily streak <strong>{me.dailyStreak.current}</strong> · best {me.dailyStreak.best}
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
