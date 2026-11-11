import { useSyncExternalStore } from 'react';
import type { MeResponse } from '@earthnow/shared';
import { api } from './api.ts';

let me: MeResponse | null = null;
const ls = new Set<() => void>();
let loading = false;

export function refreshMe(): void {
  if (loading) return;
  loading = true;
  void api
    .me()
    .then((m) => {
      me = m;
      for (const l of ls) l();
    })
    .catch(() => {})
    .finally(() => (loading = false));
}

export function setMe(m: MeResponse): void {
  me = m;
  for (const l of ls) l();
}

export function useMe(): MeResponse | null {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      if (!me) refreshMe();
      return () => ls.delete(l);
    },
    () => me,
  );
}
