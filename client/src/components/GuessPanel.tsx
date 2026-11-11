import { useEffect, useState } from 'react';
import type { CountryRef, LatLon } from '@earthnow/shared';
import { GuessMap } from '../map/GuessMap.tsx';
import { api } from '../api.ts';
import { Flag } from './ui.tsx';

type Size = 'sm' | 'md' | 'lg';

/**
 * The map you guess on. Desktop: docked bottom-right, three sizes, grows
 * while the pointer is over it. Phone: a button that opens a full sheet.
 */
export function GuessPanel({
  pin,
  onPin,
  onGuess,
  busy,
  locked,
  showCountry,
  label = 'Guess',
}: {
  pin: LatLon | null;
  onPin: (p: LatLon) => void;
  onGuess: () => void;
  busy?: boolean;
  locked?: boolean;
  showCountry?: boolean;
  label?: string;
}) {
  const [size, setSize] = useState<Size>(() => {
    try {
      return (localStorage.getItem('earthnow.mapSize') as Size) || 'md';
    } catch {
      return 'md';
    }
  });
  const [hover, setHover] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [country, setCountry] = useState<CountryRef | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('earthnow.mapSize', size);
    } catch {
      /* ignore */
    }
  }, [size]);

  useEffect(() => {
    if (!showCountry || !pin) {
      setCountry(null);
      return;
    }
    const id = setTimeout(() => void api.countryAt(pin).then((r) => setCountry(r.country)).catch(() => {}), 150);
    return () => clearTimeout(id);
  }, [pin, showCountry]);

  const effective: Size = hover && size !== 'lg' ? (size === 'sm' ? 'md' : 'lg') : size;
  const canGuess = !!pin && !busy && !locked;
  const buttonText = locked ? 'Guessed' : !pin ? 'Place your pin' : showCountry ? (country ? `Guess ${country.name}` : 'Not a country') : label;

  return (
    <>
      <div
        className={`guess-panel size-${effective} ${sheet ? 'sheet-open' : ''}`}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <div className="guess-panel-tools">
          <button type="button" className="icon-btn" aria-label="Smaller map" disabled={size === 'sm'} onClick={() => setSize(size === 'lg' ? 'md' : 'sm')}>
            −
          </button>
          <button type="button" className="icon-btn" aria-label="Bigger map" disabled={size === 'lg'} onClick={() => setSize(size === 'sm' ? 'md' : 'lg')}>
            +
          </button>
          <button type="button" className="icon-btn sheet-close" aria-label="Close map" onClick={() => setSheet(false)}>
            ✕
          </button>
        </div>
        <GuessMap pin={pin} onPin={onPin} disabled={locked} resizeKey={`${effective}-${sheet}`} />
        <button type="button" className="btn btn-primary guess-btn" disabled={!canGuess || (showCountry && !country)} onClick={onGuess} data-testid="guess-button">
          {showCountry && country && <Flag code={country.code} />} {busy ? 'Locking in…' : buttonText}
        </button>
      </div>
      <button type="button" className="btn btn-primary map-fab" onClick={() => setSheet(true)} data-testid="open-map">
        {pin ? (locked ? 'Guessed' : 'Map · pinned') : 'Open map'}
      </button>
    </>
  );
}
