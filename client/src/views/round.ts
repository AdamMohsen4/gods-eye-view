import type { Clue, GuessResponse, LatLon, StartRoundResponse } from '@earthnow/shared';
import { MAX_CLUES, scoreBand } from '@earthnow/shared';
import { api, ApiError } from '../api.ts';
import { $, el, esc, toast } from '../dom.ts';
import { ICON, ICON_UI } from '../icons.ts';
import { TYPE_LABEL, TYPE_PROMPT, formatClock, formatDistance, formatScore, secondsLeft, timeAgo } from '../lib/format.ts';
import type { GameGlobe } from '../globe/scene.ts';
import type { GuessMap } from '../map/guessMap.ts';

let globePromise: Promise<GameGlobe> | null = null;

/** The globe is created once, on the first round, and reused. */
export function getGlobe(): Promise<GameGlobe> {
  if (!globePromise) {
    globePromise = import('../globe/scene.ts').then((m) =>
      m.createGlobe(document.getElementById('stage')!, document.getElementById('credits')!),
    );
    globePromise.catch(() => (globePromise = null));
  }
  return globePromise;
}

export interface RoundOptions {
  start: StartRoundResponse;
  progress: string;
  nextLabel: string;
}

export type RoundOutcome = { result: GuessResponse; action: 'next' | 'home' };

export async function runRound(app: HTMLElement, opts: RoundOptions): Promise<RoundOutcome> {
  const { start } = opts;
  const round = start.round;
  document.body.classList.add('in-round');
  app.innerHTML = '';

  const veil = el(`<div class="loading-veil" role="status"><div style="text-align:center">Loading the view…<div class="bar-line"><i></i></div></div></div>`);
  app.append(veil);

  const globe = await getGlobe();
  await globe.showRound(round);
  veil.classList.add('gone');
  setTimeout(() => veil.remove(), 450);

  const clues: Clue[] = [...start.cluesUsed];
  const hud = el(`
    <header class="hud-top" data-testid="round-hud">
      <div class="hud-title">
        <span class="type-badge">${ICON[round.type]}</span>
        <div>
          <h2>${esc(TYPE_PROMPT[round.type])}</h2>
          <p>${esc(TYPE_LABEL[round.type])} · seen ${esc(timeAgo(round.sceneTime))}</p>
        </div>
      </div>
      <div class="hud-right">
        <span class="pill">${esc(opts.progress)}</span>
        ${start.deadline ? `<span class="timer" data-testid="timer" aria-live="off">1:00</span>` : ''}
      </div>
    </header>`);
  const clueBar = el(`<div class="clues" data-testid="clues"></div>`);
  const hint = el(`<div class="look-hint">Drag to move · scroll or pinch to zoom · right-drag or two fingers to tilt</div>`);
  const sheet = el(`
    <section class="sheet" aria-label="Place your pin">
      <div class="sheet-handle">
        <button class="sheet-toggle" type="button" aria-expanded="false">${ICON_UI.map}<span>Open map to place your pin</span></button>
      </div>
      <div class="sheet-body">
        <div class="map-host" data-testid="guess-map"><span class="map-tip">Tap to place · drag to pan · pinch to zoom</span></div>
        <button class="btn primary block" type="button" data-testid="confirm" disabled>Place a pin first</button>
      </div>
    </section>`);
  app.append(hud, clueBar, hint, sheet);

  const toggle = $('.sheet-toggle', sheet);
  sheet.addEventListener('pointerdown', () => sheet.classList.add('engaged'), { once: true });
  sheet.addEventListener('focusin', (e) => { if ((e.target as HTMLElement).matches(':focus-visible')) sheet.classList.add('engaged'); });
  const confirmBtn = $('[data-testid="confirm"]', sheet) as HTMLButtonElement;
  let map: GuessMap | null = null;
  let mapLoading: Promise<GuessMap> | null = null;
  const ensureMap = () =>
    (mapLoading ??= import('../map/guessMap.ts').then((m) => {
      map = m.createGuessMap($('.map-host', sheet), () => {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Lock in pin';
        sheet.classList.add('has-pin');
      });
      return map;
    }));
  const setOpen = (open: boolean) => {
    sheet.classList.toggle('open', open);
    document.body.classList.toggle('sheet-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    $('span', toggle).textContent = open ? 'Back to the view' : map?.pin ? 'Pin placed · open map' : 'Open map to place your pin';
    if (open) ensureMap().then((m) => m.resize());
  };
  toggle.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
  // Desktop shows the corner map right away; phones open it on demand.
  if (matchMedia('(min-width: 900px)').matches) ensureMap();

  function renderClues() {
    const used = clues
      .map((c) => `<span class="chip" data-testid="clue"><span class="k">${esc(c.label)}</span><b>${esc(c.value)}</b></span>`)
      .join('');
    const left = Math.min(MAX_CLUES, round.cluesAvailable) - clues.length;
    clueBar.innerHTML =
      used +
      (left > 0
        ? `<button class="chip" type="button" data-testid="clue-btn">${ICON_UI.clue}<span>Clue</span><span class="cost">−10%</span><span class="sr-only">${left} left</span></button>`
        : '');
    clueBar.querySelector('button')?.addEventListener('click', takeClue);
  }
  let clueBusy = false;
  async function takeClue() {
    if (clueBusy || submitted) return;
    clueBusy = true;
    try {
      const r = await api.clue(start.roundId);
      clues.push(r.clue);
      renderClues();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_more_clues') renderClues();
      else toast('Could not load the clue');
    } finally {
      clueBusy = false;
    }
  }
  renderClues();

  let submitted = false;
  let timerId = 0;
  return new Promise<RoundOutcome>((resolve) => {
    async function submit(guess: LatLon | null) {
      if (submitted) return;
      submitted = true;
      clearInterval(timerId);
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Locking in…';
      let result: GuessResponse;
      try {
        result = await api.guess(start.roundId, guess);
      } catch (e) {
        submitted = false;
        confirmBtn.disabled = !map?.pin;
        confirmBtn.textContent = 'Lock in pin';
        toast(e instanceof ApiError ? `Could not submit (${e.code})` : 'Network problem, try again');
        return;
      }
      hud.remove();
      clueBar.remove();
      hint.remove();
      sheet.remove();
      document.body.classList.remove('sheet-open');
      map?.destroy();
      await globe.reveal(result.guess, result.truth);
      showReveal(app, result, opts.nextLabel, (action) => resolve({ result, action }));
    }
    confirmBtn.addEventListener('click', () => {
      if (map?.pin) submit(map.pin);
    });

    if (start.deadline) {
      const timerEl = $('[data-testid="timer"]', hud);
      const tick = () => {
        const s = secondsLeft(start.deadline) ?? 0;
        timerEl.textContent = formatClock(s);
        timerEl.classList.toggle('low', s <= 10);
        if (s <= 0) submit(map?.pin ?? null);
      };
      tick();
      timerId = window.setInterval(tick, 250);
    }
  });
}

function showReveal(app: HTMLElement, r: GuessResponse, nextLabel: string, done: (a: 'next' | 'home') => void) {
  const band = scoreBand(r.score);
  const pct = Math.max(0.5, (r.score / 5000) * 100);
  const card = el(`
    <section class="reveal" data-testid="reveal" aria-live="polite">
      <div class="legend">${r.guess ? '<span><i style="background:#fff"></i>Your pin</span>' : ''}<span><i style="background:var(--accent)"></i>Where it was</span></div>
      <div class="reveal-score">
        <span class="pts band-${band}" data-testid="score">${formatScore(r.score)}</span>
        <span class="dist">${r.timedOut && !r.guess ? 'Time ran out' : formatDistance(r.distanceKm)}${r.timedOut && r.guess ? ' · late' : ''}</span>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="fact">
        <h3>${esc(r.fact.title)}</h3>
        <p class="sub">${esc(r.fact.subtitle)}${r.fact.country && !r.fact.subtitle.includes(r.fact.country) ? ` · ${esc(r.fact.country)}` : ''}</p>
        <ul>${r.fact.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>
      <div class="attr" data-testid="attribution">Data: ${r.attribution
        .map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.text)}</a>${a.license ? ` (${esc(a.license)})` : ''}`)
        .join(' · ')}</div>
      <div class="row">
        <button class="btn small" type="button" data-act="home">Home</button>
        <button class="btn primary" type="button" data-act="next" data-testid="next">${esc(nextLabel)} ${ICON_UI.arrow}</button>
      </div>
    </section>`);
  app.append(card);
  (card.querySelector('[data-act="next"]') as HTMLButtonElement).focus({ preventScroll: true });
  card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      card.remove();
      done(b.dataset.act as 'next' | 'home');
    }),
  );
}

export function leaveRound(): void {
  document.body.classList.remove('in-round', 'sheet-open');
}
