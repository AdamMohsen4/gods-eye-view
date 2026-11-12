import { useEffect, useState, type ReactNode } from 'react';
import { MOVE_MODES, TIME_LIMITS, type GameSettings, type MoveMode } from '@earthnow/shared';
import { serverNow } from '../hub.ts';
import { IconInfinity } from './icons.tsx';

export const MOVE_LABEL: Record<MoveMode, { short: string; long: string }> = {
  move: { short: 'Moving', long: 'Walk around, pan and zoom' },
  nomove: { short: 'No move', long: 'Pan and zoom, but stay put' },
  nmpz: { short: 'NMPZ', long: 'No moving, panning or zooming' },
};

export function timeLabel(s: number): string {
  if (!s) return 'No limit';
  return s < 60 ? `${s} s` : `${s / 60} min`;
}

export function settingsLine(s: GameSettings): string {
  return `${MOVE_LABEL[s.move].short} · ${timeLabel(s.timeLimit)}`;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** "1 play", "2,000 plays". Pass `many` for irregular plurals. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

export function countryLabel(code: string | null | undefined): string {
  if (!code) return '';
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function Flag({ code, title }: { code: string | null | undefined; title?: string }) {
  if (!code || code.length !== 2) return null;
  const emoji = String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  return (
    <span className="flag" role="img" aria-label={title ?? countryLabel(code)}>
      {emoji}
    </span>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.hint}
          disabled={disabled}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPicker({ value, onChange, disabled }: { value: GameSettings; onChange: (s: GameSettings) => void; disabled?: boolean }) {
  return (
    <div className="settings">
      <div className="field">
        <span className="field-label">Movement</span>
        <Segmented
          label="Movement"
          value={value.move}
          disabled={disabled}
          options={MOVE_MODES.map((m) => ({ value: m, label: MOVE_LABEL[m].short, hint: MOVE_LABEL[m].long }))}
          onChange={(move) => onChange({ ...value, move })}
        />
        <span className="field-hint">{MOVE_LABEL[value.move].long}</span>
      </div>
      <div className="field">
        <span className="field-label">Time per round</span>
        <Segmented
          label="Time per round"
          value={value.timeLimit}
          disabled={disabled}
          options={TIME_LIMITS.map((t) => ({ value: t, label: t ? timeLabel(t) : <><IconInfinity size={18} /><span className="sr-only">No limit</span></>, hint: t ? undefined : 'No time limit' }))}
          onChange={(timeLimit) => onChange({ ...value, timeLimit })}
        />
      </div>
    </div>
  );
}

/** Seconds left until `deadline` (ISO), ticking. Null when untimed. */
/** Seconds left until a server deadline, measured on the server's clock. */
export function useCountdown(deadline: string | null, now: () => number = serverNow): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return;
    }
    const end = new Date(deadline).getTime();
    const tick = () => setLeft(Math.max(0, (end - now()) / 1000));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline, now]);
  return left;
}

export function Timer({ left, total }: { left: number | null; total?: number }) {
  if (left === null) return null;
  const s = Math.ceil(left);
  const urgent = s <= 10;
  const pct = total ? Math.max(0, Math.min(1, left / total)) : null;
  return (
    <div className={`timer ${urgent ? 'urgent' : ''}`} role="timer" aria-label={`${s} seconds left`}>
      {pct !== null && <span className="timer-bar" style={{ transform: `scaleX(${pct})` }} />}
      <span className="timer-text">
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </span>
    </div>
  );
}

export function ScoreBar({ score, max = 5000 }: { score: number; max?: number }) {
  return (
    <div className="scorebar" aria-hidden="true">
      <span style={{ transform: `scaleX(${Math.max(0.004, score / max)})` }} />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Earthnow` : 'Earthnow';
  }, [title]);
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const ISO_CODES = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GH GL GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ ' +
  'NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ ' +
  'TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'
).split(' ');
