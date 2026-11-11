import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_SETTINGS, type GameSettings, type LeaderboardRow, type MapSummary } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { Segmented, SettingsPicker, copy, fmt, useTitle } from '../components/ui.tsx';
import { Board } from './ChallengePage.tsx';

function sizeLabel(km: number): string {
  return km >= 10000 ? 'Global' : km >= 3000 ? 'Continental' : km >= 800 ? 'Country' : 'Regional';
}

export function MapCard({ map }: { map: MapSummary }) {
  return (
    <Link to={`/maps/${map.slug}`} className="map-card">
      <span className="map-card-kind">{map.kind === 'community' ? `by ${map.creatorName ?? 'someone'}` : sizeLabel(map.scaleKm)}</span>
      <strong>{map.name}</strong>
      <span className="map-card-desc">{map.description}</span>
      <span className="map-card-meta">
        {fmt(map.locationCount)} places · {fmt(map.plays)} plays
      </span>
    </Link>
  );
}

export function MapsPage() {
  useTitle('Maps');
  const [kind, setKind] = useState<'official' | 'community'>('official');
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    setMaps(null);
    void api.maps(kind).then(setMaps).catch(() => setMaps([]));
  }, [kind]);
  const shown = (maps ?? []).filter((m) => !q || `${m.name} ${m.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="section-head">
        <h1 className="display-sm">Maps</h1>
        <Link to="/create" className="btn">
          Make a map
        </Link>
      </div>
      <div className="toolbar">
        <Segmented
          label="Map type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'official', label: 'Official' },
            { value: 'community', label: 'Community' },
          ]}
        />
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search maps" aria-label="Search maps" />
      </div>
      {!maps ? (
        <p className="muted">Loading…</p>
      ) : shown.length ? (
        <div className="map-grid">
          {shown.map((m) => (
            <MapCard key={m.id} map={m} />
          ))}
        </div>
      ) : (
        <p className="muted">{kind === 'community' ? 'No community maps yet. Be the first.' : 'No maps match.'}</p>
      )}
    </div>
  );
}

export function MapPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const [map, setMap] = useState<MapSummary | null>(null);
  const [settings, setSettings] = useState<GameSettings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem('earthnow.settings') ?? '{}') as Partial<GameSettings>), rounds: 5 };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [board, setBoard] = useState<'classic' | 'streak'>('classic');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle(map?.name ?? 'Map');

  useEffect(() => {
    void api.map(slug!).then(setMap).catch((e) => setError(errorText(e)));
  }, [slug]);
  useEffect(() => {
    void api.mapLeaderboard(slug!, board).then(setRows).catch(() => setRows([]));
  }, [slug, board]);
  useEffect(() => {
    try {
      localStorage.setItem('earthnow.settings', JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  async function start(mode: 'classic' | 'streak') {
    setBusy(true);
    try {
      const g = await api.startGame(slug!, settings, mode);
      nav(`/game/${g.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  async function challenge() {
    try {
      const { token } = await api.createChallenge(slug!, settings);
      const url = `${location.origin}/challenge/${token}`;
      setNote((await copy(url)) ? `Link copied: ${url}` : url);
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (error && !map)
    return (
      <div className="page center">
        <p role="alert">{error}</p>
        <Link className="btn" to="/maps">
          All maps
        </Link>
      </div>
    );
  if (!map) return <div className="page center muted">Loading…</div>;
  return (
    <div className="page map-page">
      <div>
        <p className="eyebrow">{map.kind === 'community' ? `Community map by ${map.creatorName ?? 'someone'}` : 'Official map'}</p>
        <h1 className="display">{map.name}</h1>
        <p className="lead">{map.description}</p>
        <p className="muted">
          {fmt(map.locationCount)} places · about {fmt(map.scaleKm)} km across · {fmt(map.plays)} plays
        </p>
        <div className="panel">
          <SettingsPicker value={settings} onChange={setSettings} />
          <div className="actions">
            <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => void start('classic')} data-testid="play-map">
              Play 5 rounds
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void start('streak')}>
              Country streak
            </button>
            <button type="button" className="btn" onClick={() => void challenge()}>
              Challenge a friend
            </button>
          </div>
          {note && (
            <p className="note" role="status">
              {note}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
      <aside className="panel">
        <div className="section-head">
          <h3>Best on this map</h3>
          <Segmented
            label="Leaderboard"
            value={board}
            onChange={setBoard}
            options={[
              { value: 'classic', label: 'Score' },
              { value: 'streak', label: 'Streak' },
            ]}
          />
        </div>
        <Board rows={rows} />
      </aside>
    </div>
  );
}
