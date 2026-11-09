import './styles.css';
import { addDays, utcDate, type RoundType } from '@earthnow/shared';
import { $, esc, toast } from './dom.ts';

const TOKEN_KEY = 'earthnow.adminToken';
const root = document.getElementById('admin')!;

interface AdminSnapshot {
  id: string;
  type: RoundType;
  source?: string;
  capturedAt?: string;
  captured_at?: string;
  trueLat?: number;
  trueLon?: number;
  true_lat?: number;
  true_lon?: number;
  fact?: { title?: string; subtitle?: string };
  payload?: Record<string, unknown>;
}
interface AdminDaily {
  date: string;
  number: number;
  published?: boolean;
  snapshots: AdminSnapshot[];
}

function token(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((json as { error?: string }).error ?? res.status));
  return json as T;
}

const lat = (s: AdminSnapshot) => s.trueLat ?? s.true_lat;
const lon = (s: AdminSnapshot) => s.trueLon ?? s.true_lon;
const cap = (s: AdminSnapshot) => s.capturedAt ?? s.captured_at ?? '';
const title = (s: AdminSnapshot) =>
  s.fact?.title ?? String((s.payload?.callsign ?? s.payload?.place ?? s.payload?.name ?? '') as string);

function render() {
  root.innerHTML = `
    <div class="page wide">
      <div class="topbar"><span class="wordmark"><span class="live-dot"></span>earthnow admin</span></div>
      <section class="card">
        <label class="field">Admin token<input type="password" data-token value="${esc(token())}" autocomplete="off" /></label>
        <div class="row"><label class="field" style="margin:0;flex:1">Date<input type="date" data-date value="${addDays(utcDate(), 1)}" /></label>
        <button class="btn small" data-load style="align-self:end">Load</button>
        <button class="btn small" data-gen style="align-self:end">Generate</button></div>
      </section>
      <section class="card" data-daily><p class="muted">Load a date to preview its Daily. Dailies lock once their date arrives.</p></section>
      <section class="card">
        <div class="eyebrow" style="margin-bottom:10px">Ban a user</div>
        <div class="row"><input class="field" style="flex:1;min-height:40px;padding:0 10px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg)" data-uid placeholder="user id" />
        <button class="btn small" data-ban>Ban</button><button class="btn small" data-unban>Unban</button></div>
      </section>
    </div>`;
  const tokenInput = $('[data-token]', root) as HTMLInputElement;
  tokenInput.addEventListener('change', () => {
    try {
      sessionStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
    } catch {
      /* ignore */
    }
  });
  const date = () => ($('[data-date]', root) as HTMLInputElement).value;
  $('[data-load]', root).addEventListener('click', () => load(date()));
  $('[data-gen]', root).addEventListener('click', async () => {
    try {
      await call('POST', `/api/admin/daily/${date()}/generate`);
      toast('Generated');
      load(date());
    } catch (e) {
      toast(`Generate failed: ${(e as Error).message}`);
    }
  });
  const ban = (banned: boolean) => async () => {
    const id = ($('[data-uid]', root) as HTMLInputElement).value.trim();
    if (!id) return;
    try {
      await call('POST', `/api/admin/users/${encodeURIComponent(id)}/ban`, { banned });
      toast(banned ? 'User banned' : 'User unbanned');
    } catch (e) {
      toast(`Failed: ${(e as Error).message}`);
    }
  };
  $('[data-ban]', root).addEventListener('click', ban(true));
  $('[data-unban]', root).addEventListener('click', ban(false));
}

async function load(d: string) {
  const host = $('[data-daily]', root);
  host.innerHTML = '<p class="muted">Loading…</p>';
  let daily: AdminDaily;
  try {
    daily = await call<AdminDaily>('GET', `/api/admin/daily/${d}`);
  } catch (e) {
    host.innerHTML = `<p class="muted">No daily for ${esc(d)} (${esc((e as Error).message)}).</p>`;
    return;
  }
  const locked = daily.published ?? d <= utcDate();
  host.innerHTML = `
    <div class="card-head"><div><div class="eyebrow">${esc(daily.date)}</div><div class="card-title">No. ${daily.number}</div></div>
    <span class="pill">${locked ? 'Published · locked' : 'Draft'}</span></div>
    <table class="lb"><tbody>${daily.snapshots
      .map(
        (s, i) => `<tr><td class="rank">${i + 1}</td><td><b>${esc(s.type)}</b> · ${esc(title(s))}<br/>
        <span class="muted mono" style="font-size:12px">${lat(s)?.toFixed(3)}, ${lon(s)?.toFixed(3)} · ${esc(cap(s))} · ${esc(s.id)}</span></td>
        <td class="r">${locked ? '' : `<button class="btn small" data-swap="${i}" data-type="${s.type}">Swap</button>`}</td></tr>`,
      )
      .join('')}</tbody></table>
    <div data-cands></div>`;
  host.querySelectorAll<HTMLButtonElement>('[data-swap]').forEach((b) =>
    b.addEventListener('click', () => candidates(d, Number(b.dataset.swap), b.dataset.type as RoundType)),
  );
}

async function candidates(d: string, index: number, type: RoundType) {
  const host = $('[data-cands]', root);
  host.innerHTML = '<p class="muted">Loading candidates…</p>';
  try {
    const res = await call<AdminSnapshot[] | { snapshots: AdminSnapshot[] }>('GET', `/api/admin/snapshots?type=${type}&limit=20`);
    const list = Array.isArray(res) ? res : res.snapshots;
    host.innerHTML = `<div class="eyebrow" style="margin:16px 0 8px">Replace round ${index + 1} with</div>
      <table class="lb"><tbody>${list
        .map(
          (s) => `<tr><td>${esc(s.type)} · ${esc(title(s))}<br/><span class="muted mono" style="font-size:12px">${lat(s)?.toFixed(3)}, ${lon(s)?.toFixed(3)} · ${esc(cap(s))}</span></td>
          <td class="r"><button class="btn small" data-pick="${esc(s.id)}">Use</button></td></tr>`,
        )
        .join('')}</tbody></table>`;
    host.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await call('POST', `/api/admin/daily/${d}/swap`, { index, snapshotId: b.dataset.pick });
          toast('Swapped');
          load(d);
        } catch (e) {
          toast(`Swap failed: ${(e as Error).message}`);
        }
      }),
    );
  } catch (e) {
    host.innerHTML = `<p class="muted">Could not load candidates (${esc((e as Error).message)}).</p>`;
  }
}

render();
