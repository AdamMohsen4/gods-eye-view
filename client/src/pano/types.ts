import type { MoveMode, PanoRef, PublicConfig } from '@earthnow/shared';

export interface PanoHandle {
  /** Back to the starting panorama and heading. */
  reset(): void;
  destroy(): void;
}

export interface PanoOptions {
  pano: PanoRef;
  move: MoveMode;
  config: PublicConfig;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export type PanoMount = (el: HTMLElement, opts: PanoOptions) => Promise<PanoHandle>;
