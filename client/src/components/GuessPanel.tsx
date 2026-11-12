import { useEffect, useState } from 'react';
import type { CountryRef, LatLon } from '@earthnow/shared';
import { GuessMap } from '../map/GuessMap.tsx';
import { api } from '../api.ts';
import { Flag } from './ui.tsx';
import { IconClose, IconMinus, IconPin, IconPlus } from './icons.tsx';

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
      const v = localStorage.getItem('earthnow.mapSize');
      return v === 'sm' || v === 'md' || v === 'lg' ? v : 'md';
    } catch {
      return 'md';
    }
  });
  const [hover, setHover] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** undefined while the lookup for the current pin is in flight. */
  const [country, setCountry] = useState<CountryRef | null | undefined>(null);

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
    // Never show the previous pin's country, and ignore answers for an old pin.
    let live = true;
    setCountry(undefined);
    const id = setTimeout(
      () =>
        void api
          .countryAt(pin)
          .then((r) => live && setCountry(r.country))
          .catch(() => live && setCountry(null)),
      150,
    );
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [pin, showCountry]);

  // Escape closes the phone map sheet.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const effective: Size = hover && size !== 'lg' ? (size === 'sm' ? 'md' : 'lg') : size;
  const canGuess = !!pin && !busy && !locked && !(showCountry && country === undefined);
  const buttonText = locked
    ? 'Guessed'
    : !pin
      ? 'Place your pin'
      : showCountry
        ? country === undefined
          ? 'Checking…'
          : country
            ? `Guess ${country.name}`
            : 'Not a country'
        : label;

  return (
    <>
      <div
        className={`guess-panel size-${effective} ${sheet ? 'sheet-open' : ''}`}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <div className="guess-panel-tools">
          <button type="button" className="icon-btn" aria-label="Smaller map" disabled={size === 'sm'} onClick={() => setSize(size === 'lg' ? 'md' : 'sm')}>
            <IconMinus size={16} strokeWidth={2} />
          </button>
          <button type="button" className="icon-btn" aria-label="Bigger map" disabled={size === 'lg'} onClick={() => setSize(size === 'sm' ? 'md' : 'lg')}>
            <IconPlus size={16} strokeWidth={2} />
          </button>
          <button type="button" className="icon-btn sheet-close" aria-label="Close map" onClick={() => setSheet(false)}>
            <IconClose size={18} />
          </button>
        </div>
        <GuessMap pin={pin} onPin={onPin} disabled={locked} resizeKey={`${effective}-${sheet}`} />
        <button type="button" className="btn btn-primary guess-btn" disabled={!canGuess || (showCountry && !country)} onClick={onGuess} data-testid="guess-button">
          {showCountry && country && <Flag code={country.code} />} {busy ? 'Locking in…' : buttonText}
        </button>
      </div>
      <button type="button" className="btn btn-primary map-fab" onClick={() => setSheet(true)} data-testid="open-map">
        <IconPin size={18} /> {pin ? (locked ? 'Guessed' : 'Pinned · map') : 'Open map'}
      </button>
    </>
  );
}
