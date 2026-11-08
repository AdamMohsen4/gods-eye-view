import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

/** Live provider calls happen only with LIVE_DATA=1; everything else uses fixtures. */
export function liveData(): boolean {
  return process.env.LIVE_DATA === '1' && process.env.FIXTURE_MODE !== '1';
}

export function readFixture(rel: string): string {
  return readFileSync(join(FIXTURES_DIR, rel), 'utf8');
}

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': 'Earthnow-snapshotter/0.1', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url.replace(/\/\/[^/]*@/, '//')} → HTTP ${res.status}`);
  return res.text();
}

/** What a provider returns: rows plus the moment the data describes. */
export interface ProviderResult<T> {
  items: T[];
  /** Reference "now" for the data (real now when live, recording time for fixtures). */
  observedAt: Date;
}
