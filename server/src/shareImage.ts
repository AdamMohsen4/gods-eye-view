import { createRequire } from 'node:module';
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { Topology } from 'topojson-specification';
import sharp from 'sharp';
import { scoreBand, type LatLon, type RoundType } from '@earthnow/shared';

const W = 1080;
const H = 1350;
let landPath: string | null = null;

const projection = geoNaturalEarth1().fitExtent(
  [
    [60, 330],
    [W - 60, 330 + 600],
  ],
  { type: 'Sphere' },
);

function land(): string {
  if (landPath) return landPath;
  const require = createRequire(import.meta.url);
  const topo = require('world-atlas/land-110m.json') as Topology;
  const fc = feature(topo, topo.objects.land!) as unknown as FeatureCollection;
  landPath = geoPath(projection)(fc) ?? '';
  return landPath;
}

const TYPE_LABEL: Record<RoundType, string> = { flight: 'Flight', quake: 'Quake', fire: 'Fire', satellite: 'Satellite' };
const BAND = { green: '#4fd1a5', yellow: '#f2c14e', red: '#ef6b5b' } as const;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface ShareCardInput {
  number: number;
  total: number;
  rounds: Array<{ type: RoundType; score: number | null; guess: LatLon | null }>;
}

/** 1080×1350 share card: dimmed world and the player's pins only. No true locations. */
export function shareCardSvg(input: ShareCardInput): string {
  const sphere = geoPath(projection)({ type: 'Sphere' }) ?? '';
  const graticule = geoPath(projection)(geoGraticule10()) ?? '';
  const pins = input.rounds
    .map((r, i) => {
      if (!r.guess) return '';
      const p = projection([r.guess.lon, r.guess.lat]);
      if (!p) return '';
      const color = BAND[scoreBand(r.score ?? 0)];
      return `<g transform="translate(${p[0].toFixed(1)},${p[1].toFixed(1)})">
        <circle r="22" fill="${color}" fill-opacity="0.18"/>
        <circle r="13" fill="${color}" stroke="#0b1020" stroke-width="3"/>
        <text y="6" text-anchor="middle" font-size="16" font-weight="700" fill="#0b1020">${i + 1}</text></g>`;
    })
    .join('');
  const rows = input.rounds
    .map((r, i) => {
      const y = 1010 + i * 52;
      const score = r.score ?? 0;
      const color = BAND[scoreBand(score)];
      const width = Math.round((score / 5000) * 520);
      return `<text x="80" y="${y + 22}" font-size="28" fill="#c9d3ee">${i + 1}  ${TYPE_LABEL[r.type]}</text>
        <rect x="340" y="${y}" width="520" height="28" rx="6" fill="#1b2442"/>
        <rect x="340" y="${y}" width="${width}" height="28" rx="6" fill="${color}"/>
        <text x="${W - 80}" y="${y + 22}" font-size="28" text-anchor="end" fill="#eef2ff">${score.toLocaleString('en-US')}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#0b1020"/>
  <text x="80" y="140" font-size="44" font-weight="600" letter-spacing="2" fill="#f5a35c">EARTHNOW</text>
  <text x="80" y="200" font-size="34" fill="#9aa6c8">Daily #${input.number}</text>
  <text x="${W - 80}" y="200" font-size="72" font-weight="700" text-anchor="end" fill="#eef2ff">${esc(input.total.toLocaleString('en-US'))}</text>
  <text x="${W - 80}" y="240" font-size="24" text-anchor="end" fill="#9aa6c8">of 25,000</text>
  <path d="${sphere}" fill="#111a33"/>
  <path d="${graticule}" fill="none" stroke="#1d2850" stroke-width="1"/>
  <path d="${land()}" fill="#26324f" stroke="#33416a" stroke-width="1"/>
  ${pins}
  ${rows}
  <text x="80" y="${H - 50}" font-size="22" fill="#6f7ba0">Live-world guessing. Pins are guesses, not answers.</text>
</svg>`;
}

export async function shareCardPng(input: ShareCardInput): Promise<Buffer> {
  return sharp(Buffer.from(shareCardSvg(input))).png({ compressionLevel: 9 }).toBuffer();
}
