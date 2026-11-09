export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const n = root.querySelector(sel);
  if (!n) throw new Error(`missing ${sel}`);
  return n as HTMLElement;
}

export function toast(msg: string): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

export function utcClock(): string {
  const d = new Date();
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
