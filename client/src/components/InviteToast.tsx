import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dismissInvite, useHub } from '../hub.ts';
import { IconUsers } from './icons.tsx';

/** "Kim invited you to a party": shown on any page, gone after a minute. */
export function InviteToast() {
  const hub = useHub();
  const nav = useNavigate();
  const invite = hub.invite;
  useEffect(() => {
    if (!invite) return;
    const id = setTimeout(dismissInvite, 60_000);
    return () => clearTimeout(id);
  }, [invite]);
  if (!invite) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <IconUsers />
      <span>
        <strong>{invite.from.name}</strong> invited you to a party.
      </span>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => {
          dismissInvite();
          nav(`/party/${invite.code}`);
        }}
      >
        Join
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={dismissInvite}>
        Not now
      </button>
    </div>
  );
}
