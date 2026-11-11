import sharp from 'sharp';
import { scoreBand } from '@earthnow/shared';

const BAND = { great: '#3fae7a', good: '#d9b54a', fair: '#e08a3c', poor: '#c9553f' } as const;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** 1200×630 Open Graph card: title, total, one bar per round. No locations. */
export async function shareCardPng(opts: { title: string; subtitle: string; total: number; scores: number[] }): Promise<Buffer> {
  const max = opts.scores.length * 5000;
  const bars = opts.scores
    .map((s, i) => {
      const w = Math.max(6, Math.round((s / 5000) * 860));
      const y = 300 + i * 54;
      return `<rect x="170" y="${y}" width="860" height="34" rx="6" fill="#ffffff14"/>
<rect x="170" y="${y}" width="${w}" height="34" rx="6" fill="${BAND[scoreBand(s)]}"/>
<text x="150" y="${y + 25}" font-size="22" fill="#cfc6b4" text-anchor="end" font-family="DejaVu Sans Mono, monospace">${i + 1}</text>
<text x="1050" y="${y + 25}" font-size="22" fill="#efe7d6" font-family="DejaVu Sans Mono, monospace">${s.toLocaleString('en-US')}</text>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="1200" height="630" fill="#14201b"/>
<text x="80" y="110" font-size="40" font-weight="700" fill="#efe7d6" font-family="DejaVu Sans, sans-serif">${esc(opts.title)}</text>
<text x="80" y="155" font-size="24" fill="#a9b3a6" font-family="DejaVu Sans, sans-serif">${esc(opts.subtitle)}</text>
<text x="80" y="250" font-size="72" font-weight="700" fill="#ff7a45" font-family="DejaVu Sans, sans-serif">${opts.total.toLocaleString('en-US')}</text>
<text x="${80 + String(opts.total.toLocaleString('en-US')).length * 44}" y="250" font-size="32" fill="#a9b3a6" font-family="DejaVu Sans, sans-serif"> / ${max.toLocaleString('en-US')}</text>
${bars}
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
