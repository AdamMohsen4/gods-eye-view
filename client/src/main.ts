import './styles.css';
import type { DailyToday, MeResponse } from '@earthnow/shared';
import { buildShareText, scoreBand } from '@earthnow/shared';
import { api, ApiError, forgetGuest } from './api.ts';
import { $, el, esc, toast, utcClock } from './dom.ts';
import { ICON, ICON_UI } from './icons.ts';
import { COUNTRY_CODES, TYPE_LABEL, arcadeRemaining, flagEmoji, formatDistance, formatScore, parseShareEntry } from './lib/format.ts';
import { getGlobe, leaveRound, runRound } from './views/round.ts';
import { GEV_MIT_NOTICE } from './notices.ts';
import { prefetchRound } from './globe/prefetch.ts';

const app = document.getElementById('app')!;
let me: MeResponse | null = null;
let today: DailyToday | null = null;
let busy = false;

async function refresh() {
  [me, today] = await Promise.all([api.me(), api.today()]);
}

function nextDailyIndex(t: DailyToday): number {
  const i = t.played.findIndex((p) => p === null);
  return i === -1 ? t.rounds.length : i;
}

function regionName(code: string | null): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/* --------------------------------------------------------------- home -- */
async function renderHome() {
  leaveRound();
  try {
    await refresh();
  } catch {
    app.innerHTML = `<div class="page"><div class="home-bg"></div><p class="muted">Earthnow can’t reach its server right now. Try again in a moment.</p><button class="btn" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  const t = today!;
  const m = me!;
  const next = nextDailyIndex(t);
  const done = next >= t.rounds.length;
  const total = t.played.reduce((s, p) => s + (p?.score ?? 0), 0);
  const left = arcadeRemaining(m.arcade);
  const slots = t.rounds
    .map((r, i) => {
      const p = t.played[i];
      const cls = p ? 'done' : i === next ? 'next' : '';
      const label = p ? `<span class="band-${scoreBand(p.score)}">${formatScore(p.score)}</span>` : `<span>${i + 1}</span>`;
      return `<div class="slot ${cls}" title="${esc(TYPE_LABEL[r.type])}">${ICON[r.type]}${label}</div>`;
    })
    .join('');
  app.innerHTML = `
    <div class="home-bg"></div>
    <div class="page">
      <div class="topbar">
        <a class="wordmark" href="#/"><span class="live-dot" aria-hidden="true"></span>earthnow</a>
        <div class="row"><span class="utc" data-utc>${utcClock()}</span>
          <button class="icon-btn" type="button" data-act="profile" aria-label="Profile">${ICON_UI.user}</button></div>
      </div>
      <h1 class="hero-title">Somewhere on Earth,<br/>right now.</h1>
      <p class="hero-sub">Aircraft, satellites, quakes and fires, frozen minutes ago. Look closely, then drop your pin.</p>

      <section class="card daily-card" data-testid="daily-card">
        <div class="card-head">
          <div><div class="eyebrow">Daily Earth · ${esc(t.date)}</div><div class="card-title">No. ${t.number}</div></div>
          <div class="mono muted">${done ? `${formatScore(total)} pts` : `${next}/5`}</div>
        </div>
        <div class="slots">${slots}</div>
        ${
          done
            ? `<a class="btn primary block" href="#/results" data-testid="see-results">See today’s results ${ICON_UI.arrow}</a>`
            : `<button class="btn primary block" type="button" data-act="daily" data-testid="play-daily">${next === 0 ? 'Play today’s five' : 'Continue'} ${ICON_UI.arrow}</button>`
        }
      </section>

      <section class="card" data-testid="arcade-card">
        <div class="card-head" style="margin-bottom:10px">
          <div><div class="eyebrow">Live Arcade</div><div class="card-title">Endless, from the last minutes</div></div>
        </div>
        <div class="row">
          <span class="muted" style="font-size:14px">${left === null ? 'Unlimited rounds' : `${left} of ${m.arcade.limit} free rounds left today`}</span>
          <button class="btn small" type="button" data-act="arcade" ${left === 0 ? 'disabled' : ''}>Play</button>
        </div>
      </section>

      <div class="stats">
        <div class="stat"><b>${m.streak.current}</b><span>day streak</span></div>
        <div class="stat"><b>${m.streak.best}</b><span>best streak</span></div>
        <div class="stat"><b>${m.streak.freezeAvailable ? '1' : '0'}</b><span>streak freeze</span></div>
      </div>

      <nav class="links"><a href="#/leaderboard">Leaderboard</a><a href="#/about">About & data</a></nav>
      <p class="foot">Playing as ${esc(m.displayName)}${m.country ? ` ${flagEmoji(m.country)}` : ''}. No account needed.</p>
    </div>`;
  app.querySelector('[data-act="daily"]')?.addEventListener('click', () => playDaily());
  app.querySelector('[data-act="arcade"]')?.addEventListener('click', () => playArcade());
  app.querySelector('[data-act="profile"]')?.addEventListener('click', () => openProfile());
  warmUp();
}

let warmed = false;
/** Fetch the globe engine and pin map while the player reads the home screen. */
function warmUp() {
  if (warmed) return;
  warmed = true;
  const idle = (cb: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 600);
  idle(() => {
    import('./globe/scene.ts').catch(() => undefined);
    import('./map/guessMap.ts').catch(() => undefined);
    // Warm the first unplayed round's imagery while the home screen is up.
    if (today) {
      const r = today.rounds[nextDailyIndex(today)];
      if (r) prefetchRound(r);
    }
  });
}

/* -------------------------------------------------------------- daily -- */
async function playDaily() {
  if (busy) return;
  busy = true;
  getGlobe().catch(() => undefined); // start the engine while the API answers
  try {
    if (!today) await refresh();
    const t = today!;
    for (let i = nextDailyIndex(t); i < t.rounds.length; i++) {
      const r = t.rounds[i]!;
      let start;
      try {
        start = await api.start(r.snapshotId);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'already_played') continue;
        throw e;
      }
      const isLast = i === t.rounds.length - 1;
      // Once this round's own tiles have had a head start, warm the next one.
      const upcoming = t.rounds[i + 1];
      if (upcoming) setTimeout(() => prefetchRound(upcoming), 5000);
      const out = await runRound(app, {
        start,
        progress: `${i + 1} / ${t.rounds.length}`,
        nextLabel: isLast ? 'See results' : 'Next round',
      });
      t.played[i] = { snapshotId: r.snapshotId, score: out.result.score, distanceKm: out.result.distanceKm };
      if (out.action === 'home') {
        location.hash = '#/';
        await renderHome();
        return;
      }
    }
    location.hash = '#/results';
  } catch {
    toast('Something went wrong loading the round');
    location.hash = '#/';
    await renderHome();
  } finally {
    busy = false;
  }
}

/* ------------------------------------------------------------- arcade -- */
async function playArcade() {
  if (busy) return;
  busy = true;
  getGlobe().catch(() => undefined);
  let n = 1;
  try {
    for (;;) {
      let start;
      try {
        start = await api.arcadeNext();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'arcade_limit') {
          showArcadeLimit(Number(e.body.limit ?? 5));
          return;
        }
        throw e;
      }
      const out = await runRound(app, { start, progress: `Arcade · ${n}`, nextLabel: 'Next live round' });
      n++;
      if (out.action === 'home') break;
    }
    await renderHome();
  } catch {
    toast('Live Arcade is unavailable right now');
    await renderHome();
  } finally {
    busy = false;
  }
}

function showArcadeLimit(limit: number) {
  leaveRound();
  app.innerHTML = `
    <div class="home-bg"></div>
    <div class="page" data-testid="arcade-limit">
      <a class="back" href="#/">${ICON_UI.arrow} Home</a>
      <div class="eyebrow">Live Arcade</div>
      <h1 class="hero-title" style="margin-top:6px">That’s today’s ${limit} free rounds.</h1>
      <p class="hero-sub">New free rounds at 00:00 UTC. Earthnow Plus, with unlimited Arcade, is coming soon.</p>
      <a class="btn block" href="#/">Back home</a>
    </div>`;
}

/* ------------------------------------------------------------ results -- */
async function renderResults() {
  leaveRound();
  if (!today) await refresh();
  const t = today!;
  let summary;
  try {
    summary = await api.summary(t.date);
  } catch {
    location.hash = '#/';
    return;
  }
  me = await api.me();
  const link = `${location.origin}/share/${summary.number}/${me.id}`;
  const text = buildShareText(summary.number, summary.rounds, link);
  const rows = summary.rounds
    .map((r, i) => {
      const p = t.played[i];
      return `<div class="round-row">${ICON[r.type]}<span>${esc(TYPE_LABEL[r.type])}<br/><span class="muted" style="font-size:13px">${formatDistance(p?.distanceKm ?? null)}</span></span><span class="mono band-${scoreBand(r.score)}">${formatScore(r.score)}</span></div>`;
    })
    .join('');
  app.innerHTML = `
    <div class="home-bg"></div>
    <div class="page" data-testid="results">
      <a class="back" href="#/">${ICON_UI.arrow} Home</a>
      <div class="eyebrow">Daily Earth No. ${summary.number} · ${esc(summary.date)}</div>
      <div class="total" data-testid="total">${formatScore(summary.total)}</div>
      <div class="muted">of 25,000 · streak ${me.streak.current} ${me.streak.current === 1 ? 'day' : 'days'}</div>
      <div class="round-rows">${rows}</div>
      <pre class="share-preview" data-testid="share-text">${esc(text)}</pre>
      <button class="btn primary block" type="button" data-act="share">${ICON_UI.share} Share result</button>
      <nav class="links"><a href="#/leaderboard">Today’s leaderboard</a><a href="#/">Home</a></nav>
      <p class="foot">Next Daily Earth at 00:00 UTC.</p>
    </div>`;
  $('[data-act="share"]', app).addEventListener('click', async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* fall back to clipboard */
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Copy the text above to share');
    }
  });
}

/* -------------------------------------------------------- leaderboard -- */
async function renderLeaderboard(scope: 'global' | 'country' = 'global') {
  leaveRound();
  if (!today || !me) await refresh();
  const t = today!;
  app.innerHTML = `
    <div class="home-bg"></div>
    <div class="page" data-testid="leaderboard">
      <a class="back" href="#/">${ICON_UI.arrow} Home</a>
      <div class="eyebrow">Daily Earth No. ${t.number}</div>
      <h1 class="hero-title" style="font-size:30px">Leaderboard</h1>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${scope === 'global'}" data-scope="global">World</button>
        <button role="tab" aria-selected="${scope === 'country'}" data-scope="country">${me!.country ? `${flagEmoji(me!.country)} ${esc(regionName(me!.country))}` : 'My country'}</button>
      </div>
      <div data-lb><div class="empty">Loading…</div></div>
    </div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((b) =>
    b.addEventListener('click', () => renderLeaderboard(b.dataset.scope as 'global' | 'country')),
  );
  const host = $('[data-lb]', app);
  if (scope === 'country' && !me!.country) {
    host.innerHTML = `<div class="empty">Set your country to see how you rank at home.<br/><br/><button class="btn small" data-act="profile">Set country</button></div>`;
    $('[data-act="profile"]', host).addEventListener('click', () => openProfile(() => renderLeaderboard('country')));
    return;
  }
  try {
    const lb = await api.leaderboard(scope, t.date);
    if (!lb.rows.length) {
      host.innerHTML = `<div class="empty">No finished games yet today. Be the first.</div>`;
      return;
    }
    const row = (r: (typeof lb.rows)[number]) =>
      `<tr class="${r.isYou ? 'you' : ''}"><td class="rank">${r.rank}</td><td>${esc(r.displayName)} ${flagEmoji(r.country)}</td><td class="r">${formatScore(r.score)}</td></tr>`;
    const youOutside = lb.you && !lb.rows.some((r) => r.isYou);
    host.innerHTML = `<table class="lb"><tbody>${lb.rows.map(row).join('')}${youOutside ? row(lb.you!) : ''}</tbody></table>`;
  } catch {
    host.innerHTML = `<div class="empty">Leaderboard unavailable right now.</div>`;
  }
}

/* -------------------------------------------------------------- about -- */
async function renderAbout() {
  leaveRound();
  app.innerHTML = `
    <div class="home-bg"></div>
    <div class="page wide prose" data-testid="about">
      <a class="back" href="#/">${ICON_UI.arrow} Home</a>
      <h1 class="hero-title" style="font-size:30px;color:var(--text)">About Earthnow</h1>
      <p>Every round is a frozen snapshot of something real: an airliner at cruise, a satellite in low orbit, a recent earthquake or an active fire. Everyone gets the same Daily Earth, and rounds are never live: aircraft are at least minutes old, quakes and fires at least six hours.</p>
      <h2>What we never do</h2>
      <ul>
        <li>No people tracking: no public cameras, plate readers, phone or social data.</li>
        <li>No military, state, police, medical or privacy-listed aircraft, no small private planes, and no aircraft near takeoff or landing.</li>
        <li>No search, follow or alerts for any specific aircraft, vessel or person.</li>
        <li>Guest play stores only a random id on your device. No analytics or ad trackers.</li>
      </ul>
      <h2>Data sources</h2>
      <ul data-testid="attributions"><li class="muted">Loading…</li></ul>
      <h2>Map imagery and 3D</h2>
      <ul>
        <li>Satellite imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community).</li>
        <li>Terrain: Re:Earth / Mapterhorn, CC BY 4.0.</li>
        <li>Pin map borders: Natural Earth (public domain) via world-atlas.</li>
        <li>3D aircraft: “Boeing 787-9” by Nobilis 2, <a href="https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3" target="_blank" rel="noopener">Sketchfab</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>; optimised by God’s Eye View (geometry simplified, textures resized).</li>
        <li>Globe engine: CesiumJS (Apache 2.0).</li>
      </ul>
      <h2>Built on God’s Eye View</h2>
      <p>Earthnow’s globe code started as a fork of <a href="https://github.com/bilawalsidhu/gods-eye-view" target="_blank" rel="noopener">God’s Eye View</a> by Bilawal Sidhu, used under the MIT License:</p>
      <pre>${esc(GEV_MIT_NOTICE)}</pre>
      <h2>Your data</h2>
      <p>You can delete everything stored for this device. Your streak and scores will be removed.</p>
      <button class="btn small" type="button" data-act="delete">Delete my data</button>
    </div>`;
  $('[data-act="delete"]', app).addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.textContent = 'Tap again to delete';
      return;
    }
    try {
      await api.deleteMe();
      forgetGuest();
      today = null;
      me = null;
      toast('Your data was deleted');
      location.hash = '#/';
    } catch {
      toast('Could not delete right now');
    }
  });
  const list = $('[data-testid="attributions"]', app);
  try {
    const attrs = await api.attributions();
    list.innerHTML = attrs
      .map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.text)}</a>${a.license ? `, ${esc(a.license)}` : ''}</li>`)
      .join('');
  } catch {
    list.innerHTML = '<li>Attribution list unavailable right now.</li>';
  }
}

/* ------------------------------------------------------------ profile -- */
function openProfile(after?: () => void) {
  if (!me) return;
  const options = COUNTRY_CODES.map((c) => ({ c, n: regionName(c) }))
    .sort((a, b) => a.n.localeCompare(b.n))
    .map(({ c, n }) => `<option value="${c}" ${me!.country === c ? 'selected' : ''}>${esc(n)}</option>`)
    .join('');
  const dlg = el<HTMLDialogElement>(`
    <dialog aria-label="Profile">
      <form method="dialog">
        <h2 style="font-size:20px;margin-bottom:16px">Profile</h2>
        <label class="field">Display name<input name="displayName" maxlength="24" value="${esc(me.displayName)}" required /></label>
        <label class="field">Country (for the country leaderboard)<select name="country"><option value="">Not set</option>${options}</select></label>
        <div class="row"><button class="btn small" value="cancel" formnovalidate>Cancel</button><button class="btn primary small" value="save">Save</button></div>
      </form>
    </dialog>`);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    const form = dlg.querySelector('form')!;
    if (dlg.returnValue === 'save') {
      const fd = new FormData(form);
      try {
        me = await api.updateMe({
          displayName: String(fd.get('displayName') ?? '').trim(),
          country: String(fd.get('country') ?? '') || null,
        });
        toast('Saved');
      } catch {
        toast('Could not save');
      }
      if (after) after();
      else if (!location.hash || location.hash === '#/') renderHome();
    }
    dlg.remove();
  });
}

/* ------------------------------------------------------------- router -- */
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  if (busy && h === '/') return;
  if (h === '/results') renderResults();
  else if (h === '/leaderboard') renderLeaderboard();
  else if (h === '/about') renderAbout();
  else renderHome();
}

window.addEventListener('hashchange', route);
setInterval(() => {
  const u = document.querySelector('[data-utc]');
  if (u) u.textContent = utcClock();
}, 15_000);

// A shared link opens the Daily directly: no sign-up wall, no detour.
if (parseShareEntry(location.search) !== null) {
  history.replaceState(null, '', '/');
  getGlobe().catch(() => undefined);
  refresh()
    .then(() => (nextDailyIndex(today!) < today!.rounds.length ? playDaily() : ((location.hash = '#/results'), undefined)))
    .catch(() => renderHome());
} else {
  route();
}
