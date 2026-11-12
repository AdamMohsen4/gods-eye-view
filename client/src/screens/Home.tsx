import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ChallengeInfo, MapSummary } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { plural, settingsLine, useTitle } from '../components/ui.tsx';
import { IconArrowRight, IconFlag, IconPencil, IconUsers, IconShield } from '../components/icons.tsx';
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
          <form className="join" onSubmit={joinCode}>
            <label htmlFor="join-code">Got a code from a friend?</label>
            <span className="join-row">
              <input id="join-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Party code or challenge link" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn" disabled={!code.trim()}>
                Join
              </button>
            </span>
          </form>
        </div>
        {daily && (
          <Link to="/daily" className="daily-card">
            <span className="daily-top">
              <span>Daily #{daily.dailyNumber}</span>
              {me && me.dailyStreak.current > 0 && <span>{plural(me.dailyStreak.current, 'day')} in a row</span>}
            </span>
            <strong>{daily.finished ? 'Done for today' : 'Today’s five places'}</strong>
            <span className="daily-sub">
              {settingsLine(daily.settings)} · {plural(daily.plays, 'player')} so far
            </span>
            <span className="daily-go">
              {daily.finished ? 'See how you ranked' : 'Play today’s daily'} <IconArrowRight size={18} />
            </span>
          </Link>
        )}
      </section>

      <section className="ways" aria-labelledby="ways-h">
        <h2 id="ways-h" className="sr-only">
          More ways to play
        </h2>
        <button type="button" className="way" onClick={() => void quick('streak')}>
          <IconFlag />
          <span className="way-k">Country streak</span>
          <span className="way-d">Name the country. One wrong answer ends it.</span>
        </button>
        <Link to="/duels" className="way">
          <IconShield />
          <span className="way-k">Duels</span>
          <span className="way-d">1 v 1, live. Out-guess them to drain their health.</span>
        </Link>
        <Link to="/party" className="way">
          <IconUsers />
          <span className="way-k">Party</span>
          <span className="way-d">A private room for up to 8 friends. Share a code.</span>
        </Link>
        <Link to="/create" className="way">
          <IconPencil />
          <span className="way-k">Map maker</span>
          <span className="way-d">Pick your own places and publish a map.</span>
        </Link>
      </section>

      <section>
        <div className="section-head">
          <h2>Maps</h2>
          <Link to="/maps" className="text-link">
            All maps <IconArrowRight size={16} />
          </Link>
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
