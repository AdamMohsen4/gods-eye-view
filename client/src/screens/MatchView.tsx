import { useEffect, useState } from 'react';
import { DUEL_HP, formatDistance, type LatLon, type MatchState, type PlayerPublic } from '@earthnow/shared';
import { PanoView } from '../pano/PanoView.tsx';
import { ResultMap } from '../map/ResultMap.tsx';
import { PLAYER_COLORS } from '../map/pins.ts';
import { GuessPanel } from '../components/GuessPanel.tsx';
import { Flag, Timer, fmt, useCountdown } from '../components/ui.tsx';
import { send, serverNow } from '../hub.ts';

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function MatchView({ match, me, onExit, exitLabel }: { match: MatchState; me: string; onExit: () => void; exitLabel: string }) {
  const [pin, setPin] = useState<LatLon | null>(null);
  const roundKey = match.round?.index ?? -1;
  useEffect(() => setPin(null), [roundKey]);

  const color = (id: string) => PLAYER_COLORS[match.players.findIndex((p) => p.id === id) % PLAYER_COLORS.length]!;
  const duel = match.format === 'duel';
  const left = useCountdown(match.phase === 'round' ? (match.round?.endsAt ?? null) : null, serverNow);
  const startIn = useCountdown(match.phase === 'starting' ? match.startsAt : null, serverNow);
  const nextIn = useCountdown(match.phase === 'reveal' ? (match.reveal?.nextAt ?? null) : null, serverNow);
  const guessed = !!match.round?.guessed.includes(me);
  const myPlayer = match.players.find((p) => p.id === me);
  const eliminated = duel && (myPlayer?.hp ?? 1) <= 0;

  useEffect(() => {
    if (left === 0 && pin && !guessed && match.round) send({ t: 'match.guess', matchId: match.id, guess: pin });
  }, [left, pin, guessed, match.id, match.round]);

  const guess = () => {
    if (pin && !guessed) send({ t: 'match.guess', matchId: match.id, guess: pin });
  };

  return (
    <div className="play">
      {match.phase === 'round' && match.round && <PanoView pano={match.round.pano} move={match.settings.move} />}

      <div className="hud match-hud">
        {duel ? <DuelBars players={match.players} me={me} color={color} /> : <Standings players={match.players} me={me} color={color} />}
        <div className="hud-right">
          {match.round && match.round.multiplier > 1 && match.phase === 'round' && <span className="mult">×{match.round.multiplier} damage</span>}
          <Timer left={left} />
        </div>
      </div>

      {match.phase === 'starting' && (
        <div className="overlay">
          <div className="overlay-card">
            <p className="eyebrow">{duel ? (match.ranked ? 'Ranked duel' : 'Duel') : 'Party game'} · {match.map.name}</p>
            <h2 className="display-sm">{duel ? match.players.map((p) => p.name).join(' vs ') : `${match.players.length} players`}</h2>
            <p className="countdown">{startIn !== null ? Math.ceil(startIn) : ''}</p>
          </div>
        </div>
      )}

      {match.phase === 'round' && match.round && (
        <>
          {guessed && (
            <div className="waiting" role="status">
              Guess locked in. Waiting for {match.players.filter((p) => p.connected && !match.round!.guessed.includes(p.id) && (!duel || p.hp > 0)).map((p) => p.name).join(', ') || 'the round to end'}…
            </div>
          )}
          {!guessed && match.round.guessed.length > 0 && <div className="waiting alt">{match.round.guessed.length === 1 && duel ? 'Your opponent has guessed. The clock is running.' : `${match.round.guessed.length} guessed`}</div>}
          {!eliminated && <GuessPanel pin={pin} onPin={setPin} onGuess={guess} locked={guessed} />}
        </>
      )}

      {(match.phase === 'reveal' || match.phase === 'finished') && match.reveal && (
        <div className="reveal">
          <ResultMap
            pairs={[
              {
                truth: match.reveal.truth,
                guesses: match.reveal.guesses.map((g) => ({ at: g.guess, label: initials(match.players.find((p) => p.id === g.playerId)?.name ?? '?'), color: color(g.playerId) })),
              },
            ]}
            padding={{ top: 130, bottom: 380, left: 60, right: 60 }}
          />
          <section className="reveal-card wide" aria-live="polite">
            {match.phase === 'finished' ? (
              <Finished match={match} me={me} />
            ) : (
              <>
                <p className="eyebrow">
                  Round {match.reveal.index + 1} · <Flag code={match.reveal.country?.code} /> {match.reveal.country?.name ?? ''}
                  {match.reveal.multiplier > 1 && ` · ×${match.reveal.multiplier}`}
                </p>
                <RoundTable match={match} color={color} />
                <p className="muted small">Next round in {nextIn !== null ? Math.ceil(nextIn) : '…'} s</p>
              </>
            )}
            {match.reveal.credit && <p className="credit">Imagery: {match.reveal.credit}</p>}
            {match.phase === 'finished' && (
              <button type="button" className="btn btn-primary" onClick={onExit}>
                {exitLabel}
              </button>
            )}
          </section>
        </div>
      )}

      {match.phase !== 'finished' && (
        <button
          type="button"
          className="btn btn-glass leave-btn"
          onClick={() => {
            send({ t: 'match.leave', matchId: match.id });
            onExit();
          }}
        >
          {duel ? 'Forfeit' : 'Leave'}
        </button>
      )}
    </div>
  );
}

function DuelBars({ players, me, color }: { players: PlayerPublic[]; me: string; color: (id: string) => string }) {
  const ordered = [...players].sort((a) => (a.id === me ? -1 : 1));
  return (
    <div className="duel-bars">
      {ordered.map((p, i) => (
        <div key={p.id} className={`duel-bar ${i === 1 ? 'right' : ''} ${p.connected ? '' : 'offline'}`}>
          <span className="duel-name">
            <Flag code={p.country} /> {p.name} <small>{p.rating}</small>
          </span>
          <span className="hp">
            <span style={{ transform: `scaleX(${p.hp / DUEL_HP})`, background: color(p.id) }} />
          </span>
          <span className="hp-num">{fmt(p.hp)}</span>
        </div>
      ))}
    </div>
  );
}

function Standings({ players, me, color }: { players: PlayerPublic[]; me: string; color: (id: string) => string }) {
  const sorted = [...players].sort((a, b) => b.total - a.total);
  return (
    <ol className="standings">
      {sorted.map((p) => (
        <li key={p.id} className={`${p.id === me ? 'me' : ''} ${p.connected ? '' : 'offline'}`}>
          <span className="dot" style={{ background: color(p.id) }} />
          {p.name}
          <strong>{fmt(p.total)}</strong>
        </li>
      ))}
    </ol>
  );
}

function RoundTable({ match, color }: { match: MatchState; color: (id: string) => string }) {
  const rows = [...match.reveal!.guesses].sort((a, b) => b.score - a.score);
  return (
    <table className="round-table">
      <tbody>
        {rows.map((g) => {
          const p = match.players.find((x) => x.id === g.playerId);
          return (
            <tr key={g.playerId}>
              <td>
                <span className="dot" style={{ background: color(g.playerId) }} /> {p?.name}
              </td>
              <td>{g.guess ? formatDistance(g.distanceKm) : 'no guess'}</td>
              <td className="num">{fmt(g.score)}</td>
              {match.format === 'duel' && <td className="num dmg">{g.damage ? `−${fmt(g.damage)}` : ''}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Finished({ match, me }: { match: MatchState; me: string }) {
  const winner = match.players.find((p) => p.id === match.result?.winnerId);
  const change = match.result?.ratingChange[me];
  const sorted = [...match.players].sort((a, b) => (match.format === 'duel' ? b.hp - a.hp : b.total - a.total));
  return (
    <>
      <p className="eyebrow">Final · {match.history.length} rounds</p>
      <h2 className="display-sm">{!winner ? 'A draw' : winner.id === me ? 'You won' : `${winner.name} wins`}</h2>
      {change !== undefined && change !== 0 && (
        <p className={change > 0 ? 'ok' : 'bad'}>
          Rating {change > 0 ? '+' : ''}
          {change}
        </p>
      )}
      <ol className="final-list">
        {sorted.map((p, i) => (
          <li key={p.id} className={p.id === me ? 'me' : ''}>
            <span className="rank">{i + 1}</span>
            {p.name}
            <strong>{match.format === 'duel' ? `${fmt(p.hp)} HP` : fmt(p.total)}</strong>
          </li>
        ))}
      </ol>
    </>
  );
}
