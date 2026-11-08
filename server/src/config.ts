export interface Config {
  roundTimerSeconds: number;
  timerGraceSeconds: number;
  arcadeFreeRoundsPerDay: number;
  adminToken: string | null;
  publicOrigin: string;
  rateLimitMax: number;
}

export function loadConfig(env = process.env): Config {
  return {
    roundTimerSeconds: Number(env.ROUND_TIMER_SECONDS ?? 60),
    timerGraceSeconds: 5,
    arcadeFreeRoundsPerDay: Number(env.ARCADE_FREE_ROUNDS_PER_DAY ?? 5),
    adminToken: env.ADMIN_TOKEN && env.ADMIN_TOKEN !== 'change-me' ? env.ADMIN_TOKEN : null,
    publicOrigin: (env.PUBLIC_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
    rateLimitMax: Number(env.RATE_LIMIT_MAX ?? 120),
  };
}
