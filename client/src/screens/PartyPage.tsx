import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ELIMINATION_LIVES, type MapSummary, type PartySettings, type PlayerPublic } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { clearError, getHub, leaveParty, requestParty, send, useHub } from '../hub.ts';
import { Flag, Segmented, SettingsPicker, copy, useTitle } from '../components/ui.tsx';
import { refreshMe } from '../me.ts';
import { MatchView, TEAM_COLORS, TEAM_NAMES } from './MatchView.tsx';
import { MapShape } from '../components/MapShape.tsx';
import { IconCopy } from '../components/icons.tsx';
import type { FriendView } from '@earthnow/shared';

const FORMATS: { value: PartySettings['format']; label: string; desc: string }[] = [
  { value: 'classic', label: 'Everyone scores', desc: 'Everyone plays every round. Highest total wins.' },
  { value: 'duel', label: 'Duel', desc: 'Two players, 5,000 health each. The worse guess loses the difference.' },
  { value: 'teams', label: 'Teams', desc: 'Two teams share 5,000 health. A team’s best guess counts.' },
  { value: 'elimination', label: 'Elimination', desc: `${ELIMINATION_LIVES} lives each. The worst guess of a round costs one.` },
];

export function PartyPage() {
  const { code: rawCode } = useParams<{ code?: string }>();
  const code = rawCode?.toUpperCase();
  const nav = useNavigate();
  const hub = useHub();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const asked = useRef<string | null>(null);
  useTitle(code ? `Party ${code}` : 'Party');
  // hub.error is global; don't show one left over from another page.
  useEffect(() => clearError(), []);

  useEffect(() => {
    void api.maps().then(setMaps).catch(() => {});
  }, []);

  // Join the room in the URL, or create one. requestParty forgets any old room first.
  useEffect(() => {
    const want = code ?? 'new';
    if (asked.current === want) return;
    asked.current = want;
    if (code && getHub().party?.code === code) return;
    requestParty(code ?? null);
  }, [code]);

  // A freshly created room: put its code in the URL. Reads the live store, so a
  // room we just left (still in this render's props) can never redirect us back.
  useEffect(() => {
    const live = getHub().party;
    if (!code && live && asked.current === 'new') {
      asked.current = live.code;
      nav(`/party/${live.code}`, { replace: true });
    }
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
  const online = party.players.filter((p) => p.connected);
  const sides = new Set(online.map((p) => p.team ?? 0));
  const blocker =
    s.format === 'duel' && online.length !== 2
      ? 'A duel needs exactly 2 players'
      : s.format === 'teams' && sides.size < 2
        ? 'Each team needs a player'
        : s.format === 'elimination' && online.length < 2
          ? 'Elimination needs 2 or more players'
          : null;
  const canStart = host && !blocker;
  const playerRow = (p: PlayerPublic) => (
    <li key={p.id} className={p.connected ? '' : 'offline'}>
      <Flag code={p.country} /> {p.name}
      {p.id === party.hostId && <span className="tag">host</span>}
      {p.id === hub.userId && <span className="tag">you</span>}
      {!p.connected && <span className="tag">away</span>}
      {s.format === 'teams' && host && p.id !== hub.userId && (
        <button type="button" className="link-btn" onClick={() => send({ t: 'party.team', playerId: p.id, team: p.team === 1 ? 0 : 1 })}>
          Move to {TEAM_NAMES[p.team === 1 ? 0 : 1]}
        </button>
      )}
      {host && p.id !== hub.userId && (
        <button type="button" className="link-btn" onClick={() => send({ t: 'party.kick', playerId: p.id })}>
          Remove
        </button>
      )}
    </li>
  );
  const myTeam = party.players.find((p) => p.id === hub.userId)?.team ?? 0;

  return (
    <div className="page party">
      <div>
        <h1 className="display">
          Party <span className="code">{party.code}</span>
        </h1>
        <div className="actions">
          <button type="button" className="btn" onClick={async () => setNote((await copy(link)) ? 'Invite link copied.' : link)}>
            <IconCopy size={18} /> Copy invite link
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              leaveParty();
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
            <span className="field-label" id="format-label">
              Format
            </span>
            <div className="format-grid" role="radiogroup" aria-labelledby="format-label">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={s.format === f.value}
                  className={s.format === f.value ? 'on' : ''}
                  disabled={!host}
                  onClick={() => update({ format: f.value })}
                >
                  <strong>{f.label}</strong>
                  <span>{f.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="party-map">
              Map
            </label>
            <select id="party-map" value={s.mapSlug} disabled={!host} onChange={(e) => update({ mapSlug: e.target.value })}>
              {party.map && !maps.some((m) => m.slug === s.mapSlug) && <option value={s.mapSlug}>{party.map.name}</option>}
              {maps.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                  {m.kind === 'community' ? ` (by ${m.creatorName ?? 'someone'})` : ''}
                </option>
              ))}
            </select>
            {party.map && <MapShape countries={party.map.countries} bounds={party.map.bounds} width={480} height={140} className="party-shape" />}
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
              {blocker ?? 'Start'}
            </button>
          ) : (
            <p className="muted">Waiting for the host to start…</p>
          )}
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
        <h3>
          Players <small className="muted">{party.players.length} / 8</small>
        </h3>
        {s.format === 'teams' ? (
          <div className="team-cols">
            {[0, 1].map((t) => (
              <section key={t} className="team-col">
                <h4 style={{ color: TEAM_COLORS[t] }}>{TEAM_NAMES[t]}</h4>
                <ul className="players">{party.players.filter((p) => (p.team ?? 0) === t).map(playerRow)}</ul>
                {myTeam !== t && (
                  <button type="button" className="btn btn-sm" onClick={() => send({ t: 'party.team', team: t })}>
                    Join {TEAM_NAMES[t]}
                  </button>
                )}
              </section>
            ))}
          </div>
        ) : (
          <ul className="players">{party.players.map(playerRow)}</ul>
        )}
        {party.players.length < 2 && <p className="muted small">Send the invite link to friends. Anyone with it can join, no account needed.</p>}
        <InviteFriends inRoom={party.players.map((p) => p.id)} invited={hub.invited} />
      </aside>
    </div>
  );
}

/** Online friends who aren't in the room yet, one tap to invite. */
function InviteFriends({ inRoom, invited }: { inRoom: string[]; invited: string[] }) {
  const [friends, setFriends] = useState<FriendView[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void api
        .friends()
        .then((i) => live && setFriends(i.friends.filter((f) => f.status === 'friend')))
        .catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  if (!friends?.length) return null;
  const out = friends.filter((f) => !inRoom.includes(f.id));
  if (!out.length) return null;
  return (
    <div className="invite-friends">
      <h4>Invite friends</h4>
      <ul className="players">
        {out.map((f) => (
          <li key={f.id} className={f.online ? '' : 'offline'}>
            <span className={`presence ${f.online ? 'on' : ''}`} aria-label={f.online ? 'Online' : 'Offline'} />
            <Flag code={f.country} /> {f.name}
            {invited.includes(f.id) ? (
              <span className="tag tag-ok">invited</span>
            ) : (
              <button type="button" className="link-btn" disabled={!f.online} onClick={() => send({ t: 'party.invite', userId: f.id })}>
                {f.online ? 'Invite' : 'offline'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
