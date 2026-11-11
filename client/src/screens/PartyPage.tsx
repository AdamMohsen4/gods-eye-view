import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MapSummary, PartySettings } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { clearError, send, useHub } from '../hub.ts';
import { Flag, Segmented, SettingsPicker, copy, useTitle } from '../components/ui.tsx';
import { refreshMe } from '../me.ts';
import { MatchView } from './MatchView.tsx';

export function PartyPage() {
  const { code } = useParams<{ code?: string }>();
  const nav = useNavigate();
  const hub = useHub();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const asked = useRef<string | null>(null);
  useTitle(code ? `Party ${code}` : 'Party');

  useEffect(() => {
    void api.maps().then(setMaps).catch(() => {});
  }, []);

  // Join the room in the URL, or create one.
  useEffect(() => {
    const want = code ?? 'new';
    if (asked.current === want) return;
    if (code && hub.party?.code === code) return;
    asked.current = want;
    send(code ? { t: 'party.join', code } : { t: 'party.create' });
  }, [code, hub.party?.code]);

  useEffect(() => {
    if (hub.party && hub.party.code !== code && asked.current === (code ?? 'new')) nav(`/party/${hub.party.code}`, { replace: true });
  }, [hub.party, code, nav]);

  const party = hub.party && hub.party.code === code ? hub.party : null;
  const match = party?.matchId ? hub.matches[party.matchId] : undefined;

  if (match && hub.userId && match.id !== dismissed)
    return (
      <MatchView
        match={match}
        me={hub.userId}
        exitLabel="Back to lobby"
        onExit={() => {
          setDismissed(match.id);
          refreshMe();
        }}
      />
    );

  if (hub.partyClosed === 'kicked')
    return (
      <div className="page center">
        <p>The host removed you from the party.</p>
        <button type="button" className="btn" onClick={() => nav('/')}>
          Home
        </button>
      </div>
    );

  if (!party)
    return (
      <div className="page center">
        {hub.error ? (
          <>
            <p role="alert">{errorText(new Error(hub.error.code))}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                clearError();
                asked.current = null;
                nav('/party');
              }}
            >
              Start a new party
            </button>
          </>
        ) : (
          <p className="muted">{code ? 'Joining…' : 'Opening a room…'}</p>
        )}
      </div>
    );

  const host = party.hostId === hub.userId;
  const s = party.settings;
  const update = (patch: Partial<PartySettings>) => send({ t: 'party.settings', settings: patch });
  const link = `${location.origin}/party/${party.code}`;
  const online = party.players.filter((p) => p.connected).length;
  const canStart = host && (s.format === 'duel' ? online === 2 : online >= 1);

  return (
    <div className="page party">
      <div>
        <p className="eyebrow">Private room</p>
        <h1 className="display">
          Party <span className="code">{party.code}</span>
        </h1>
        <div className="actions">
          <button type="button" className="btn" onClick={async () => setNote((await copy(link)) ? 'Invite link copied.' : link)}>
            Copy invite link
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              send({ t: 'party.leave' });
              nav('/');
            }}
          >
            Leave
          </button>
        </div>
        {note && (
          <p className="note" role="status">
            {note}
          </p>
        )}
        <div className="panel">
          <h3>Settings {host ? '' : <small className="muted">· the host picks</small>}</h3>
          <div className="field">
            <span className="field-label">Format</span>
            <Segmented
              label="Format"
              value={s.format}
              disabled={!host}
              onChange={(format) => update({ format })}
              options={[
                { value: 'classic', label: 'Everyone scores', hint: 'Highest total after all rounds wins' },
                { value: 'duel', label: 'Duel', hint: 'Two players, health bars' },
              ]}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="party-map">
              Map
            </label>
            <select id="party-map" value={s.mapSlug} disabled={!host} onChange={(e) => update({ mapSlug: e.target.value })}>
              {maps.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                  {m.kind === 'community' ? ` (by ${m.creatorName ?? 'someone'})` : ''}
                </option>
              ))}
            </select>
          </div>
          <SettingsPicker value={s} disabled={!host} onChange={(v) => update({ move: v.move, timeLimit: v.timeLimit })} />
          {s.format === 'classic' && (
            <div className="field">
              <span className="field-label">Rounds</span>
              <Segmented label="Rounds" value={s.rounds} disabled={!host} onChange={(rounds) => update({ rounds })} options={[3, 5, 7, 10].map((n) => ({ value: n, label: String(n) }))} />
            </div>
          )}
          {host ? (
            <button type="button" className="btn btn-primary btn-lg" disabled={!canStart} onClick={() => send({ t: 'party.start' })} data-testid="start-party">
              {s.format === 'duel' && online !== 2 ? 'A duel needs exactly 2 players' : 'Start'}
            </button>
          ) : (
            <p className="muted">Waiting for the host to start…</p>
          )}
          {hub.error && (
            <p role="alert" onClick={clearError}>
              {errorText(new Error(hub.error.code))}
            </p>
          )}
        </div>
      </div>
      <aside className="panel">
        <h3>
          Players <small className="muted">{party.players.length} / 8</small>
        </h3>
        <ul className="players">
          {party.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'offline'}>
              <Flag code={p.country} /> {p.name}
              {p.id === party.hostId && <span className="tag">host</span>}
              {p.id === hub.userId && <span className="tag">you</span>}
              {!p.connected && <span className="tag">away</span>}
              {host && p.id !== hub.userId && (
                <button type="button" className="link-btn" onClick={() => send({ t: 'party.kick', playerId: p.id })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {party.players.length < 2 && <p className="muted small">Send the invite link to friends. Anyone with it can join, no account needed.</p>}
      </aside>
    </div>
  );
}
