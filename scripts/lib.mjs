// Společné pomůcky: text, čas (vše v místním čase Europe/Prague jako "YYYY-MM-DDTHH:MM"), HTTP.
import { createHash } from 'node:crypto';

export const TZ = 'Europe/Prague';

export const normalize = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
export function decodeHtml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  return decodeHtml(String(s || '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function truncate(s, n = 600) {
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
}

// ---- čas -------------------------------------------------------------------
// "Nástěnný" čas reprezentujeme jako Date v UTC se stejnými čísly (žádné posuny DST při počítání dnů).
export const wall = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
export const fmt = (dt, allDay = false) => {
  const iso = dt.toISOString();
  return allDay ? iso.slice(0, 10) : iso.slice(0, 16);
};
export const parseWall = (s) => {
  const [d, t = '00:00'] = s.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return wall(y, mo, da, h, mi);
};
export const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

const pragueFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** Skutečný okamžik (UTC) → nástěnný čas v Praze. */
export function utcToWall(date) {
  const p = Object.fromEntries(pragueFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return wall(+p.year, +p.month, +p.day, +p.hour, +p.minute);
}
/** Nástěnný čas v Praze → skutečný okamžik (pro .ics v UTC). */
export function wallToUtc(w) {
  let guess = new Date(w.getTime());
  for (let i = 0; i < 2; i++) guess = new Date(guess.getTime() + (w - utcToWall(guess)));
  return guess;
}
export const todayWall = () => {
  const n = utcToWall(new Date());
  return wall(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate());
};

// ---- HTTP ------------------------------------------------------------------
export async function fetchText(url, { tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'KalendarVB/1.0 (+https://github.com)', Accept: '*/*' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last?.message || last}`);
}
export const fetchJson = async (url) => JSON.parse(await fetchText(url));
