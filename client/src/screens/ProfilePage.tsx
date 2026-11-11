import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProfileStats } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { Flag, ISO_CODES, countryLabel, fmt, useTitle } from '../components/ui.tsx';
import { setMe, useMe } from '../me.ts';

const MODE_LABEL = { classic: 'Classic', daily: 'Daily', challenge: 'Challenge', streak: 'Streak' } as const;

export function ProfilePage() {
  useTitle('Profile');
  const me = useMe();
  const nav = useNavigate();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void api.stats().then(setStats).catch(() => {});
  }, []);
  useEffect(() => {
    if (me) {
      setName(me.displayName);
      setCountry(me.country ?? '');
    }
  }, [me]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMe(await api.updateMe({ displayName: name, country: country || null }));
      setNote('Saved.');
    } catch (err) {
      setNote(errorText(err));
    }
  }

  const countries = [...ISO_CODES].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const lvl = me?.level;
  const pct = lvl ? (lvl.xp - lvl.floor) / Math.max(1, lvl.next - lvl.floor) : 0;

  return (
    <div className="page profile">
      <section>
        <p className="eyebrow">Profile</p>
        <h1 className="display">
          <Flag code={me?.country} /> {me?.displayName ?? '…'}
        </h1>
        {lvl && (
          <div className="level">
            <span>Level {lvl.level}</span>
            <span className="level-bar">
              <span style={{ transform: `scaleX(${pct})` }} />
            </span>
            <span className="muted small">
              {fmt(lvl.xp - lvl.floor)} / {fmt(lvl.next - lvl.floor)} XP
            </span>
          </div>
        )}
        <form className="panel form" onSubmit={save}>
          <label className="field">
            <span className="field-label">Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          </label>
          <label className="field">
            <span className="field-label">Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Not shown</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {countryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
          {note && <span className="note">{note}</span>}
        </form>
        <p className="muted small">
          You’re playing as a guest. Your progress is tied to this browser.{' '}
          {confirmDelete ? (
            <>
              Delete everything?{' '}
              <button
                type="button"
                className="link-btn danger"
                onClick={async () => {
                  await api.deleteMe();
                  try {
                    localStorage.removeItem('earthnow.guestId');
                  } catch {
                    /* ignore */
                  }
                  nav('/');
                  location.reload();
                }}
              >
                Yes, delete
              </button>{' '}
              <button type="button" className="link-btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={() => setConfirmDelete(true)}>
              Delete my data
            </button>
          )}
        </p>
      </section>
      <section>
        {stats && (
          <>
            <div className="stat-grid">
              <Stat k="Games" v={fmt(stats.gamesPlayed)} />
              <Stat k="Average round" v={fmt(stats.averageScore)} />
              <Stat k="Best game" v={fmt(stats.bestGame)} />
              <Stat k="Perfect rounds" v={fmt(stats.perfectRounds)} />
              <Stat k="Best streak" v={fmt(stats.bestStreak)} />
              <Stat k="Daily streak" v={`${me?.dailyStreak.current ?? 0} (best ${me?.dailyStreak.best ?? 0})`} />
              <Stat k="Duel rating" v={fmt(stats.duels.rating)} />
              <Stat k="Duels won" v={`${stats.duels.won} / ${stats.duels.played}`} />
            </div>
            <div className="panel">
              <h3>Recent games</h3>
              {stats.recent.length ? (
                <ul className="recent">
                  {stats.recent.map((g) => (
                    <li key={g.gameId}>
                      <Link to={`/game/${g.gameId}`}>
                        <span>{MODE_LABEL[g.mode]}</span>
                        <span className="muted">{g.mapName}</span>
                        <strong>{g.mode === 'streak' ? `${g.streak} streak` : fmt(g.score)}</strong>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No finished games yet. <Link to="/maps">Pick a map</Link>.
                </p>
              )}
            </div>
            {stats.countries.length > 0 && (
              <div className="panel">
                <h3>By country</h3>
                <ul className="by-country">
                  {stats.countries.map((c) => (
                    <li key={c.code}>
                      <Flag code={c.code} /> {c.name}
                      <span className="muted">{c.rounds} rounds</span>
                      <strong>{fmt(c.averageScore)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <span className="stat-k">{k}</span>
      <span className="stat-v">{v}</span>
    </div>
  );
}
