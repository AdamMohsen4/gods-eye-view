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
}

let state: HubState = {
  status: 'idle',
  userId: null,
  queue: { waiting: false, since: null, ranked: false },
  party: null,
  partyClosed: null,
  matches: {},
  error: null,
};
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
let outbox: ClientMessage[] = [];
let retry = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
/** Clock offset so countdowns match the server. */
let skewMs = 0;

function set(patch: Partial<HubState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function serverNow(): number {
  return Date.now() + skewMs;
}

function connect() {
  if (ws && ws.readyState <= 1) return;
  set({ status: 'connecting' });
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    ws!.send(JSON.stringify({ t: 'hello', guestId: guestId() } satisfies ClientMessage));
    pingTimer = setInterval(() => send({ t: 'ping' }), 25_000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    switch (msg.t) {
      case 'welcome': {
        set({ status: 'online', userId: msg.userId });
        const pending = outbox;
        outbox = [];
        for (const m of pending) ws!.send(JSON.stringify(m));
        break;
      }
      case 'queue.status':
        set({ queue: { waiting: msg.waiting, since: msg.since, ranked: msg.ranked } });
        break;
      case 'party.state':
        set({ party: msg.party, partyClosed: null });
        break;
      case 'party.closed':
        set({ party: null, partyClosed: msg.reason });
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
    set({ status: 'offline' });
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
}

export function send(msg: ClientMessage) {
  connect();
  if (ws && ws.readyState === 1 && state.status === 'online') ws.send(JSON.stringify(msg));
  else if (msg.t !== 'ping') outbox.push(msg);
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

/** Estimate clock skew from a server timestamp header once. */
void fetch('/api/health').then((r) => {
  const d = r.headers.get('date');
  if (d) skewMs = new Date(d).getTime() - Date.now();
  if (Math.abs(skewMs) < 1500) skewMs = 0;
}).catch(() => {});
