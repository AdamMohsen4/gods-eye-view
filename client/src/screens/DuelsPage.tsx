import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardRow } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { clearError, getHub, send, serverNow, useHub } from '../hub.ts';
import { useTitle } from '../components/ui.tsx';
import { useMe, refreshMe } from '../me.ts';
import { Board } from './ChallengePage.tsx';
import { MatchView } from './MatchView.tsx';

export function DuelsPage() {
  useTitle('Duels');
  // hub.error is global; don't show one left over from another page.
  useEffect(() => clearError(), []);
  const hub = useHub();
  const me = useMe();
  const [active, setActive] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [top, setTop] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    void api.ratingLeaderboard().then(setTop).catch(() => {});
  }, [active]);

  // Open a duel when one starts (and resume one already running).
  useEffect(() => {
    const duels = Object.values(hub.matches).filter((m) => m.format === 'duel' && m.id !== hub.party?.matchId);
    if (!known.current) {
      known.current = new Set(duels.map((m) => m.id));
      const running = duels.find((m) => m.phase !== 'finished');
      if (running) setActive(running.id);
      return;
    }
    for (const m of duels) {
      if (!known.current.has(m.id)) {
        known.current.add(m.id);
        setActive(m.id);
      }
    }
  }, [hub.matches, hub.party?.matchId]);

  // Leaving the page leaves the queue, so a duel never starts while you're elsewhere.
  useEffect(
    () => () => {
      if (getHub().queue.waiting) send({ t: 'queue.leave' });
    },
    [],
  );

  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!hub.queue.waiting) return;
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, [hub.queue.waiting]);

  const match = active ? hub.matches[active] : null;
  if (match && hub.userId)
    return (
      <MatchView
        match={match}
        me={hub.userId}
        exitLabel="Back to duels"
        onExit={() => {
          setActive(null);
          refreshMe();
        }}
      />
    );

  const since = hub.queue.since ? Math.floor((now - new Date(hub.queue.since).getTime()) / 1000) : 0;
  return (
    <div className="page duels">
      <div>
        <h1 className="display">Duels</h1>
        <p className="facts">
          <span>1 v 1</span>
          <span>World map</span>
          <span>Moving</span>
        </p>
        <p className="lead">
          Both of you see the same place. When one locks in, the other has 15 seconds. Each round, the worse guess loses the difference in points from their 5,000 health. From round 4 the damage multiplies.
        </p>
        <div className="panel">
          {hub.queue.waiting ? (
            <div className="queue" role="status">
              <span className="pulse" aria-hidden="true" />
              <div>
                <strong>Looking for an opponent{hub.queue.ranked ? ' (ranked)' : ''}…</strong>
                <span className="muted"> {since}s</span>
              </div>
              <button type="button" className="btn" onClick={() => send({ t: 'queue.leave' })}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => send({ t: 'queue.join', ranked: true })} disabled={hub.status !== 'online'} data-testid="ranked-duel">
                Ranked duel
              </button>
              <button type="button" className="btn btn-lg" onClick={() => send({ t: 'queue.join', ranked: false })} disabled={hub.status !== 'online'}>
                Casual duel
              </button>
            </div>
          )}
          <p className="muted small">
            Your rating: <strong>{me?.rating ?? 1000}</strong> · To duel a friend, open a <Link to="/party">party</Link> and set the format to Duel.
          </p>
          {hub.status !== 'online' && <p className="muted small">Connecting…</p>}
          {hub.error && (
            <p role="alert" className="form-error">
              {errorText(new Error(hub.error.code))}{' '}
              <button type="button" className="link-btn" onClick={clearError}>
                Dismiss
              </button>
            </p>
          )}
        </div>
      </div>
      <aside className="panel">
        <h3>Top rated</h3>
        <Board rows={top.slice(0, 20)} />
      </aside>
    </div>
  );
}
