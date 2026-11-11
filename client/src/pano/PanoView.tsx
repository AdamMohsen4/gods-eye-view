import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MoveMode, PanoRef } from '@earthnow/shared';
import { api } from '../api.ts';
import type { PanoHandle, PanoMount } from './types.ts';

const MOUNTS: Record<PanoRef['provider'], () => Promise<PanoMount>> = {
  fixture: async () => (await import('./fixture.ts')).mountFixture,
  mapillary: async () => (await import('./mapillary.ts')).mountMapillary,
  google: async () => (await import('./google.ts')).mountGoogle,
};

export interface PanoViewHandle {
  reset(): void;
}

/** Full-bleed panorama for one round. Remounts when the panorama changes. */
export const PanoView = forwardRef<PanoViewHandle, { pano: PanoRef; move: MoveMode }>(function PanoView({ pano, move }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<PanoHandle | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ reset: () => handle.current?.reset() }), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    const node = el.current!;
    (async () => {
      const [config, mount] = await Promise.all([api.config(), MOUNTS[pano.provider]()]);
      if (cancelled) return;
      const h = await mount(node, {
        pano,
        move,
        config,
        onReady: () => !cancelled && setStatus('ready'),
        onError: (m) => {
          if (cancelled) return;
          setStatus('error');
          setError(m);
        },
      });
      if (cancelled) h.destroy();
      else handle.current = h;
    })().catch((e: Error) => {
      if (cancelled) return;
      setStatus('error');
      setError(e.message);
    });
    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
    };
  }, [pano.provider, pano.panoId, pano.heading, move]);

  return (
    <div className="pano" data-status={status} data-move={move}>
      <div ref={el} className="pano-host" />
      {status === 'loading' && <div className="pano-veil">Loading panorama…</div>}
      {status === 'error' && (
        <div className="pano-veil pano-error" role="alert">
          <strong>Couldn’t load this panorama.</strong>
          <span>{error}</span>
          <span>You can still guess. Pin the map and lock it in.</span>
        </div>
      )}
    </div>
  );
});
