import type { RoundType } from '@earthnow/shared';

const wrap = (body: string, label: string) =>
  `<svg class="icon" viewBox="0 0 24 24" role="img" aria-label="${label}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON: Record<RoundType, string> = {
  flight: wrap('<path d="M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5V17l7.5-2.2V19l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4.2L21 17z"/>', 'Aircraft'),
  satellite: wrap('<rect x="9.5" y="9.5" width="5" height="5" rx="1" transform="rotate(45 12 12)"/><path d="m5 5 3.5 3.5M15.5 15.5 19 19M3 9l4-4M15 21l4-4M7 3 3 7M21 15l-4 4"/><path d="M17 4.5a5 5 0 0 1 2.5 2.5"/>', 'Satellite'),
  fire: wrap('<path d="M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.8-2.9-6.2-4.4-9.8-.9 2.2-2 3.3-3.4 3.9.3-2-.4-4-1.7-5.9C7.6 7 5.5 10 5.5 14.8 5.5 18.4 8.1 21 12 21z"/><path d="M12 21c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.4-2.8 2.8-4.7 1.4 1.9 2.8 2.9 2.8 4.7 0 1.6-1.1 2.8-2.8 2.8z"/>', 'Wildfire'),
  quake: wrap('<path d="M2 12h3l2-5 3 10 3-14 3 12 2-3h4"/>', 'Earthquake'),
};

export const ICON_UI = {
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>', 'Close'),
  arrow: wrap('<path d="M5 12h14M13 6l6 6-6 6"/>', ''),
  share: wrap('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>', ''),
  clue: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>', ''),
  user: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', 'Profile'),
  map: wrap('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', ''),
};
