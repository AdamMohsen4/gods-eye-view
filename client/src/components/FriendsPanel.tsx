import { useEffect, useState } from 'react';
import type { FriendView, FriendsInfo } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { Flag, copy } from './ui.tsx';
import { IconCheck, IconClose, IconCopy } from './icons.tsx';

/** Your friend code, requests, and friends with who's online. Refreshes while open. */
export function FriendsPanel() {
  const [info, setInfo] = useState<FriendsInfo | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      void api
        .friends()
        .then((i) => live && setInfo(i))
        .catch(() => {});
    load();
    const id = setInterval(load, 20_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  async function run(p: Promise<FriendsInfo>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      setInfo(await p);
      if (done) setNote(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    await run(api.addFriend(code.trim()), 'Request sent. They’ll see it next time they open Earthnow.');
    setCode('');
  }

  const incoming = info?.friends.filter((f) => f.status === 'incoming') ?? [];
  const friends = info?.friends.filter((f) => f.status === 'friend') ?? [];
  const outgoing = info?.friends.filter((f) => f.status === 'outgoing') ?? [];

  return (
    <section className="panel friends" aria-labelledby="friends-h">
      <h3 id="friends-h">Friends</h3>
      {info && (
        <p className="friend-code">
          Your code <strong>{info.code}</strong>
          <button type="button" className="btn btn-sm btn-ghost" onClick={async () => setNote((await copy(info.code)) ? 'Code copied.' : info.code)}>
            <IconCopy size={16} /> Copy
          </button>
        </p>
      )}
      <form className="join-row" onSubmit={add}>
        <label htmlFor="friend-code" className="sr-only">
          A friend’s code
        </label>
        <input id="friend-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A friend’s code" maxLength={6} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn" disabled={busy || code.trim().length !== 6}>
          Add
        </button>
      </form>
      {note && (
        <p className="note" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {incoming.length > 0 && (
        <>
          <h4>Requests</h4>
          <ul className="friend-list">
            {incoming.map((f) => (
              <Row key={f.id} f={f}>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(api.acceptFriend(f.id), `You and ${f.name} are friends now.`)}>
                  <IconCheck size={16} /> Accept
                </button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} aria-label={`Decline ${f.name}`} onClick={() => void run(api.removeFriend(f.id))}>
                  <IconClose size={16} />
                </button>
              </Row>
            ))}
          </ul>
        </>
      )}

      {friends.length > 0 ? (
        <ul className="friend-list">
          {friends.map((f) => (
            <Row key={f.id} f={f}>
              <button type="button" className="link-btn" disabled={busy} onClick={() => void run(api.removeFriend(f.id))}>
                Remove
              </button>
            </Row>
          ))}
        </ul>
      ) : (
        info && incoming.length === 0 && <p className="muted small">Swap codes with a friend to see when they’re online and invite them to a party.</p>
      )}

      {outgoing.length > 0 && (
        <>
          <h4>Waiting for an answer</h4>
          <ul className="friend-list">
            {outgoing.map((f) => (
              <Row key={f.id} f={f}>
                <button type="button" className="link-btn" disabled={busy} onClick={() => void run(api.removeFriend(f.id))}>
                  Cancel
                </button>
              </Row>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Row({ f, children }: { f: FriendView; children: React.ReactNode }) {
  return (
    <li>
      {f.status === 'friend' && <span className={`presence ${f.online ? 'on' : ''}`} aria-label={f.online ? 'Online' : 'Offline'} />}
      <Flag code={f.country} />
      <span className="friend-name">{f.name}</span>
      <span className="muted small">Level {f.level}</span>
      <span className="friend-actions">{children}</span>
    </li>
  );
}
