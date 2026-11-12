/**
 * Badges: milestones derived from a player's record. Nothing is stored;
 * the server computes progress from games and matches on each profile view.
 */
export interface BadgeMetrics {
  gamesFinished: number;
  perfectRounds: number;
  bestGame: number;
  countriesPlayed: number;
  bestStreak: number;
  bestDailyStreak: number;
  duelsWon: number;
  rating: number;
  mapsPublished: number;
  matchesPlayed: number;
}

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  metric: keyof BadgeMetrics;
  goal: number;
  /** Where progress starts counting (a rating starts at 1,000, not 0). */
  start?: number;
}

export interface BadgeProgress {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  /** Current value, capped at `goal`. */
  progress: number;
  goal: number;
  /** Progress bars run from here to `goal`. */
  start: number;
}

export const BADGES: BadgeDef[] = [
  { id: 'first-game', name: 'First steps', description: 'Finish your first game.', metric: 'gamesFinished', goal: 1 },
  { id: 'regular', name: 'Regular', description: 'Finish 25 games.', metric: 'gamesFinished', goal: 25 },
  { id: 'bullseye', name: 'Bullseye', description: 'Score a perfect 5,000 in a round.', metric: 'perfectRounds', goal: 1 },
  { id: 'twenty-k', name: 'Twenty thousand', description: 'Score 20,000 or more in one game.', metric: 'bestGame', goal: 20_000 },
  { id: 'globetrotter', name: 'Globetrotter', description: 'Play rounds in 25 different countries.', metric: 'countriesPlayed', goal: 25 },
  { id: 'atlas', name: 'Atlas', description: 'Play rounds in 75 different countries.', metric: 'countriesPlayed', goal: 75 },
  { id: 'on-a-roll', name: 'On a roll', description: 'Name 10 countries in a row in a country streak.', metric: 'bestStreak', goal: 10 },
  { id: 'every-day', name: 'Every day', description: 'Play the daily seven days in a row.', metric: 'bestDailyStreak', goal: 7 },
  { id: 'duelist', name: 'Duelist', description: 'Win a duel.', metric: 'duelsWon', goal: 1 },
  { id: 'contender', name: 'Contender', description: 'Reach a duel rating of 1,200.', metric: 'rating', goal: 1200, start: 1000 },
  { id: 'cartographer', name: 'Cartographer', description: 'Publish a map of your own.', metric: 'mapsPublished', goal: 1 },
  { id: 'good-company', name: 'Good company', description: 'Play 10 live matches: duels, parties or teams.', metric: 'matchesPlayed', goal: 10 },
];

export function badgeProgress(m: BadgeMetrics): BadgeProgress[] {
  return BADGES.map((b) => {
    const v = Math.max(0, m[b.metric]);
    return { id: b.id, name: b.name, description: b.description, earned: v >= b.goal, progress: Math.min(v, b.goal), goal: b.goal, start: b.start ?? 0 };
  });
}
