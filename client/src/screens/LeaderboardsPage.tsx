import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChallengeInfo, LeaderboardRow, MapSummary } from '@earthnow/shared';
import { api } from '../api.ts';
import { Segmented, useTitle } from '../components/ui.tsx';
import { Board, ChallengeBoard } from './ChallengePage.tsx';

export function LeaderboardsPage() {
  useTitle('Leaderboards');
  const [tab, setTab] = useState<'daily' | 'rating' | 'maps'>('daily');
  const [daily, setDaily] = useState<ChallengeInfo | null>(null);
  const [rating, setRating] = useState<LeaderboardRow[]>([]);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [slug, setSlug] = useState('world');
  const [mode, setMode] = useState<'classic' | 'streak'>('classic');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    void api.daily().then(setDaily).catch(() => {});
    void api.ratingLeaderboard().then(setRating).catch(() => {});
    void api.maps().then(setMaps).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true; // quick toggles: never let an older answer overwrite a newer one
    void api
      .mapLeaderboard(slug, mode)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug, mode]);

  return (
    <div className="page narrow">
      <h1 className="display-sm">Leaderboards</h1>
      <Segmented
        label="Leaderboard"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'daily', label: 'Today’s daily' },
          { value: 'rating', label: 'Duel rating' },
          { value: 'maps', label: 'Maps' },
        ]}
      />
      <div className="panel">
        {tab === 'daily' &&
          (daily?.finished ? (
            <ChallengeBoard token={daily.token} />
          ) : (
            <p>
              The daily board opens once you’ve played today. <Link to="/daily">Play Daily #{daily?.dailyNumber}</Link>
            </p>
          ))}
        {tab === 'rating' && <Board rows={rating} />}
        {tab === 'maps' && (
          <>
            <div className="toolbar">
              <select value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Map">
                {maps.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Segmented
                label="Metric"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'classic', label: 'Best score' },
                  { value: 'streak', label: 'Best streak' },
                ]}
              />
            </div>
            <Board rows={rows} />
          </>
        )}
      </div>
    </div>
  );
}
