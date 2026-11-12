import { useEffect, useRef, useState } from 'react';
import { DUEL_HP, ELIMINATION_LIVES, formatDistance, type LatLon, type MatchState, type PlayerPublic } from '@earthnow/shared';
import { PanoView } from '../pano/PanoView.tsx';
import { ResultMap } from '../map/ResultMap.tsx';
import { PLAYER_COLORS } from '../map/pins.ts';
import { GuessPanel } from '../components/GuessPanel.tsx';
import { Flag, Timer, fmt, useCountdown } from '../components/ui.tsx';
import { send, serverNow } from '../hub.ts';
import { IconHeart } from '../components/icons.tsx';

export const TEAM_NAMES = ['Orange', 'Blue'];
export const TEAM_COLORS = ['#ff6b35', '#3b82c4'];

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

  const teams = match.format === 'teams';
  const color = (id: string) => {
    const i = match.players.findIndex((p) => p.id === id);
    return teams ? TEAM_COLORS[match.players[i]?.team ?? 0]! : PLAYER_COLORS[i % PLAYER_COLORS.length]!;
  };
  const duel = match.format === 'duel';
  const elim = match.format === 'elimination';
  const left = useCountdown(match.phase === 'round' ? (match.round?.endsAt ?? null) : null, serverNow);
  const startIn = useCountdown(match.phase === 'starting' ? match.startsAt : null, serverNow);
  const nextIn = useCountdown(match.phase === 'reveal' ? (match.reveal?.nextAt ?? null) : null, serverNow);
  const guessed = !!match.round?.guessed.includes(me);
  const myPlayer = match.players.find((p) => p.id === me);
  const eliminated = (duel && (myPlayer?.hp ?? 1) <= 0) || (elim && (myPlayer?.lives ?? 1) <= 0);
  const stillIn = (p: PlayerPublic) => (duel ? p.hp > 0 : elim ? p.lives > 0 : true);

  // One guess per round (locked in, or sent automatically just before the clock runs out).
  // If the server hasn't confirmed it after 1.5 s (rejected or lost), allow another try.
  const sent = useRef<{ round: number; at: number } | null>(null);
  const sendGuess = (p: LatLon) => {
    if (!match.round || guessed) return;
    const s = sent.current;
    if (s && s.round === match.round.index && Date.now() - s.at < 1500) return;
    sent.current = { round: match.round.index, at: Date.now() };
    send({ t: 'match.guess', matchId: match.id, guess: p });
  };
  useEffect(() => {
    if (left !== null && left <= 0.4 && pin) sendGuess(pin);
  });

  const guess = () => {
    if (pin) sendGuess(pin);
  };

  return (
    <div className="play">
      {match.phase === 'round' && match.round && <PanoView pano={match.round.pano} move={match.settings.move} />}

      <div className="hud match-hud">
        {duel ? (
          <DuelBars players={match.players} me={me} color={color} />
        ) : teams ? (
          <TeamBars match={match} me={me} />
        ) : elim ? (
          <Lives players={match.players} me={me} color={color} />
        ) : (
          <Standings players={match.players} me={me} color={color} />
        )}
        <div className="hud-right">
          {match.round && match.round.multiplier > 1 && match.phase === 'round' && <span className="mult">×{match.round.multiplier} damage</span>}
          <Timer left={left} />
        </div>
      </div>

      {match.phase === 'starting' && (
        <div className="overlay">
          <div className="overlay-card">
            <h2 className="display-sm">
              {duel ? match.players.map((p) => p.name).join(' vs ') : teams ? `${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]}` : `${match.players.length} players`}
            </h2>
            <p className="facts on-dark">
              <span>{duel ? (match.ranked ? 'Ranked duel' : 'Duel') : teams ? 'Team duel' : elim ? `Elimination · ${ELIMINATION_LIVES} lives each` : 'Party game'}</span>
              <span>{match.map.name}</span>
            </p>
            <p className="countdown">{startIn !== null ? Math.ceil(startIn) : ''}</p>
          </div>
        </div>
      )}

      {match.phase === 'round' && match.round && (
        <>
          {guessed && (
            <div className="waiting" role="status">
              Guess locked in. Waiting for {match.players.filter((p) => p.connected && !match.round!.guessed.includes(p.id) && stillIn(p)).map((p) => p.name).join(', ') || 'the round to end'}…
            </div>
          )}
          {!guessed && !eliminated && match.round.guessed.length > 0 && (
            <div className="waiting alt">
              {match.round.guessed.length === 1 && duel ? 'Your opponent has guessed. The clock is running.' : match.round.guessed.length === 1 && teams ? 'First guess is in. The clock is running.' : `${match.round.guessed.length} guessed`}
            </div>
          )}
          {eliminated && (
            <div className="waiting" role="status">
              You’re out. Watching the rest play on.
            </div>
          )}
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
            padding={{ top: 140, bottom: 380, left: 80, right: 80 }}
          />
          <section className="reveal-card wide" aria-live="polite">
            {match.phase === 'finished' ? (
              <Finished match={match} me={me} />
            ) : (
              <>
                <h2 className="reveal-place">
                  <Flag code={match.reveal.country?.code} /> {match.reveal.country?.name ?? 'Somewhere'}
                </h2>
                <p className="facts">
                  <span>Round {match.reveal.index + 1}</span>
                  {match.reveal.multiplier > 1 && <span>×{match.reveal.multiplier} damage</span>}
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
          {duel ? 'Forfeit' : elim && !eliminated ? 'Give up' : 'Leave'}
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

function TeamBars({ match, me }: { match: MatchState; me: string }) {
  const mine = match.players.find((p) => p.id === me)?.team ?? 0;
  const order = mine === 0 ? [0, 1] : [1, 0];
  return (
    <div className="duel-bars">
      {order.map((t, i) => (
        <div key={t} className={`duel-bar ${i === 1 ? 'right' : ''}`}>
          <span className="duel-name">
            {TEAM_NAMES[t]} {t === mine && <small>your team</small>}
          </span>
          <span className="hp">
            <span style={{ transform: `scaleX(${(match.teams?.[t]?.hp ?? 0) / DUEL_HP})`, background: TEAM_COLORS[t] }} />
          </span>
          <span className="hp-num">{fmt(match.teams?.[t]?.hp ?? 0)}</span>
          <span className="team-members">
            {match.players
              .filter((p) => p.team === t)
              .map((p) => p.name)
              .join(', ')}
          </span>
        </div>
      ))}
    </div>
  );
}

function Hearts({ n }: { n: number }) {
  return (
    <span className="hearts" aria-label={`${n} ${n === 1 ? 'life' : 'lives'} left`}>
      {Array.from({ length: ELIMINATION_LIVES }, (_, i) => (
        <IconHeart key={i} size={14} className={`icon ${i < n ? 'heart-on' : 'heart-off'}`} />
      ))}
    </span>
  );
}

function Lives({ players, me, color }: { players: PlayerPublic[]; me: string; color: (id: string) => string }) {
  const sorted = [...players].sort((a, b) => b.lives - a.lives || b.total - a.total);
  return (
    <ol className="standings">
      {sorted.map((p) => (
        <li key={p.id} className={`${p.id === me ? 'me' : ''} ${p.connected && p.lives > 0 ? '' : 'offline'}`}>
          <span className="dot" style={{ background: color(p.id) }} />
          {p.name}
          <Hearts n={p.lives} />
        </li>
      ))}
    </ol>
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
  const td = match.reveal!.teamDamage;
  return (
    <>
      {td && (
        <p className="team-damage">
          {[0, 1].map((t) => (
            <span key={t} style={{ color: TEAM_COLORS[t] }}>
              {TEAM_NAMES[t]} {td[t] ? `−${fmt(td[t]!)}` : 'no damage'}
            </span>
          ))}
        </p>
      )}
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
              {match.format === 'elimination' && <td className="num dmg">{g.lostLife ? '−1 life' : ''}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}

function Finished({ match, me }: { match: MatchState; me: string }) {
  const winner = match.players.find((p) => p.id === match.result?.winnerId);
  const change = match.result?.ratingChange[me];
  const sorted = [...match.players].sort((a, b) =>
    match.format === 'duel' ? b.hp - a.hp : match.format === 'elimination' ? b.lives - a.lives || b.total - a.total : match.format === 'teams' ? (a.team ?? 0) - (b.team ?? 0) || b.total - a.total : b.total - a.total,
  );
  const wt = match.result?.winnerTeam ?? null;
  const myTeam = match.players.find((p) => p.id === me)?.team ?? null;
  const headline =
    match.format === 'teams'
      ? wt === null
        ? 'A draw'
        : wt === myTeam
          ? 'Your team won'
          : `${TEAM_NAMES[wt]} wins`
      : !winner
        ? 'A draw'
        : winner.id === me
          ? match.format === 'elimination'
            ? 'You’re the last one standing'
            : 'You won'
          : match.format === 'elimination'
            ? `${winner.name} is the last one standing`
            : `${winner.name} wins`;
  return (
    <>
      <h2 className="display-sm">{headline}</h2>
      <p className="facts">
        <span>Final</span>
        <span>{match.history.length} rounds</span>
      </p>
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
            {match.format === 'teams' && <span className="tag" style={{ color: TEAM_COLORS[p.team ?? 0] }}>{TEAM_NAMES[p.team ?? 0]}</span>}
            {match.format === 'elimination' && <Hearts n={p.lives} />}
            <strong>{match.format === 'duel' ? `${fmt(p.hp)} HP` : fmt(p.total)}</strong>
          </li>
        ))}
      </ol>
    </>
  );
}
