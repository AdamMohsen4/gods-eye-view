import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ChallengeInfo, MapSummary } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { fmt, settingsLine, useTitle } from '../components/ui.tsx';
import { useMe } from '../me.ts';
import { MapCard } from './MapsPage.tsx';

export function Home() {
  useTitle('');
  const nav = useNavigate();
  const me = useMe();
  const [daily, setDaily] = useState<ChallengeInfo | null>(null);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.daily().then(setDaily).catch(() => {});
    void api.maps('official').then(setMaps).catch(() => {});
  }, []);

  async function quick(mode: 'classic' | 'streak') {
    try {
      const g = await api.startGame('world', { move: 'move', timeLimit: 0 }, mode);
      nav(`/game/${g.id}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  function joinCode(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    // Party codes are 5 characters; anything longer is a challenge link or token.
    const token = c.includes('/challenge/') ? c.split('/challenge/')[1]!.split(/[?#]/)[0]! : c;
    nav(token.length === 5 ? `/party/${token.toUpperCase()}` : `/challenge/${token}`);
  }

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Street-level geography</p>
          <h1 className="display">
            You’re standing somewhere on Earth. <em>Where?</em>
          </h1>
          <p className="lead">Look around. Read the signs, the road lines, the plants and the plates. Then drop a pin. The closer you are, the more points you get.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void quick('classic')} data-testid="play-world">
              Play the world
            </button>
            <Link className="btn btn-lg" to="/maps">
              Choose a map
            </Link>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
        {daily && (
          <Link to="/daily" className="daily-card">
            <span className="eyebrow">Daily #{daily.dailyNumber}</span>
            <strong>{daily.finished ? 'Done for today' : 'Today’s five places'}</strong>
            <span className="muted">{settingsLine(daily.settings)}</span>
            <span className="daily-meta">
              <span>{fmt(daily.plays)} played</span>
              {me && <span>Streak {me.dailyStreak.current}</span>}
            </span>
            <span className="daily-go">{daily.finished ? 'See the leaderboard →' : 'Play →'}</span>
          </Link>
        )}
      </section>

      <section className="modes" aria-label="Game modes">
        <button type="button" className="mode" onClick={() => void quick('streak')}>
          <span className="mode-k">Country streak</span>
          <span className="mode-d">Name the country. One wrong answer ends it.</span>
        </button>
        <Link to="/duels" className="mode">
          <span className="mode-k">Duels</span>
          <span className="mode-d">1 v 1, live. Out-guess them to drain their health.</span>
        </Link>
        <Link to="/party" className="mode">
          <span className="mode-k">Party</span>
          <span className="mode-d">Private room for up to 8 friends. Share a code, play together.</span>
        </Link>
        <Link to="/create" className="mode">
          <span className="mode-k">Map maker</span>
          <span className="mode-d">Pick your own places and publish a map for everyone.</span>
        </Link>
        <form className="mode mode-form" onSubmit={joinCode}>
          <label className="mode-k" htmlFor="join-code">
            Got a code?
          </label>
          <span className="mode-row">
            <input id="join-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Party code or challenge link" autoComplete="off" />
            <button type="submit" className="btn">
              Join
            </button>
          </span>
        </form>
      </section>

      <section>
        <div className="section-head">
          <h2>Maps</h2>
          <Link to="/maps">All maps →</Link>
        </div>
        <div className="map-grid">
          {maps.slice(0, 8).map((m) => (
            <MapCard key={m.id} map={m} />
          ))}
        </div>
      </section>
    </div>
  );
}
