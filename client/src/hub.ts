/** Realtime connection for duels and parties. One socket per tab, reconnects on its own. */
import { useSyncExternalStore } from 'react';
import type { ClientMessage, MatchState, PartyState, ServerMessage } from '@earthnow/shared';
import { guestId } from './api.ts';

export interface HubState {
  status: 'idle' | 'connecting' | 'online' | 'offline';
  userId: string | null;
  queue: { waiting: boolean; since: string | null; ranked: boolean };
  party: PartyState | null;
  partyClosed: string | null;
  matches: Record<string, MatchState>;
  error: { code: string; at: number } | null;
  /** A friend asked you to join their party. */
  invite: { code: string; from: { id: string; name: string }; at: number } | null;
  /** Friends you invited to your current party (delivered). */
  invited: string[];
}

let state: HubState = {
  status: 'idle',
  userId: null,
  queue: { waiting: false, since: null, ranked: false },
  party: null,
  partyClosed: null,
  matches: {},
  error: null,
  invite: null,
  invited: [],
};
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
/** Messages sent while offline; replayed on reconnect only if still fresh. */
let outbox: { msg: ClientMessage; at: number }[] = [];
const OUTBOX_TTL_MS = 8000;
let retry = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pingSentAt = 0;
/** Clock offset so countdowns match the server, from the sample with the shortest round trip. */
let skewMs = 0;
let bestRtt = Infinity;

/** Server time `serverMs` was read somewhere between `sentAt` and `receivedAt` (local clock). */
function sampleClock(serverMs: number, sentAt: number, receivedAt: number) {
  const rtt = receivedAt - sentAt;
  if (!(rtt >= 0) || rtt > bestRtt) return;
  bestRtt = rtt;
  skewMs = serverMs + rtt / 2 - receivedAt;
}

function set(patch: Partial<HubState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function serverNow(): number {
  return Date.now() + skewMs;
}

/** Current store value outside React (for effects that must not act on a stale render). */
export function getHub(): HubState {
  return state;
}

function ping() {
  pingSentAt = Date.now();
  send({ t: 'ping' });
}

function connect() {
  if (ws && ws.readyState <= 1) return;
  set({ status: 'connecting' });
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    // A new connection (maybe after sleep or a clock change): measure skew afresh.
    bestRtt = Infinity;
    ws!.send(JSON.stringify({ t: 'hello', guestId: guestId() } satisfies ClientMessage));
    pingTimer = setInterval(ping, 25_000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    switch (msg.t) {
      case 'welcome': {
        // Drop unfinished matches the server no longer has (e.g. after a restart). Live ones
        // stay put, so an open MatchView keeps its pin and panorama across a reconnect;
        // their fresh state follows right after this message.
        const live = new Set(msg.matchIds ?? []);
        const matches = Object.fromEntries(Object.entries(state.matches).filter(([id, m]) => m.phase === 'finished' || live.has(id)));
        set({ status: 'online', userId: msg.userId, matches });
        ping();
        const fresh = outbox.filter((o) => Date.now() - o.at < OUTBOX_TTL_MS);
        outbox = [];
        for (const o of fresh) ws!.send(JSON.stringify(o.msg));
        break;
      }
      case 'pong':
        sampleClock(msg.now, pingSentAt, Date.now());
        break;
      case 'queue.status':
        set({ queue: { waiting: msg.waiting, since: msg.since, ranked: msg.ranked } });
        break;
      case 'party.state':
        // A new room forgets who was invited to the old one.
        set({ party: msg.party, partyClosed: null, invited: state.party?.code === msg.party.code ? state.invited : [] });
        break;
      case 'party.invite':
        // Already in that room: nothing to ask.
        if (state.party?.code !== msg.code) set({ invite: { code: msg.code, from: msg.from, at: Date.now() } });
        break;
      case 'party.invited':
        set({ invited: [...new Set([...state.invited, msg.userId])] });
        break;
      case 'party.closed':
        // 'none' just means "you're in no party" (sent on connect).
        set({ party: null, partyClosed: msg.reason === 'none' || msg.reason === 'left' ? null : msg.reason });
        break;
      case 'match.state': {
        const m = msg.match;
        set({ matches: { ...state.matches, [m.id]: m } });
        break;
      }
      case 'error':
        set({ error: { code: msg.code, at: Date.now() } });
        break;
    }
  };
  ws.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    // The server drops you from the queue when your last socket closes.
    set({ status: 'offline', queue: { waiting: false, since: null, ranked: false } });
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
}

export function send(msg: ClientMessage) {
  connect();
  if (ws && ws.readyState === 1 && state.status === 'online') ws.send(JSON.stringify(msg));
  else if (msg.t !== 'ping') outbox.push({ msg, at: Date.now() });
}

/** Join a party (or create one with `null`), forgetting the one we were in. */
export function requestParty(code: string | null) {
  set({ party: null, partyClosed: null });
  send(code ? { t: 'party.join', code } : { t: 'party.create' });
}

export function leaveParty() {
  set({ party: null, partyClosed: null });
  send({ t: 'party.leave' });
}

export function dismissInvite() {
  set({ invite: null });
}

export function clearError() {
  set({ error: null });
}

export function useHub(): HubState {
  connect();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** First clock estimate over HTTP, so solo timers are right even without a socket. */
{
  const sentAt = Date.now();
  void fetch('/api/health')
    .then((r) => r.json() as Promise<{ now?: number }>)
    .then((b) => {
      if (typeof b.now === 'number') sampleClock(b.now, sentAt, Date.now());
    })
    .catch(() => {});
}
