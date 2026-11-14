// iCal (např. veřejný Google kalendář): VEVENT, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY), EXDATE, RECURRENCE-ID.
import { fetchText, wall, fmt, parseWall, addDays, utcToWall, todayWall, stripHtml } from '../lib.mjs';

const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, name, paramStr, value] = m;
    const params = Object.fromEntries(paramStr.split(';').filter(Boolean).map((p) => p.split('=')));
    (cur[name] ||= []).push({ value, params });
  }
  return events;
}

/** Hodnota DTSTART/DTEND/EXDATE → { dt: nástěnný čas, allDay } */
function parseDate({ value, params }) {
  const v = value.trim();
  if (/^\d{8}$/.test(v) || params.VALUE === 'DATE') {
    return { dt: wall(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8)), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (z) return { dt: utcToWall(new Date(Date.UTC(+y, mo - 1, +d, +h, +mi))), allDay: false };
  // TZID=Europe/Prague nebo plovoucí čas → bereme jako místní
  return { dt: wall(+y, +mo, +d, +h, +mi), allDay: false };
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Rozvine RRULE do seznamu začátků (nástěnný čas) v intervalu [from, to]. */
function expandRrule(rule, start, from, to) {
  const r = Object.fromEntries(rule.split(';').map((p) => p.split('=')));
  const interval = +(r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  let until = to;
  if (r.UNTIL) {
    const u = parseDate({ value: r.UNTIL, params: {} });
    if (u && u.dt < until) until = u.allDay ? addDays(u.dt, 1) : u.dt;
  }
  const h = start.getUTCHours(), mi = start.getUTCMinutes();
  const out = [];
  let n = 0;
  const push = (dt) => {
    if (dt < start || dt > until || n >= count) return false;
    n++;
    if (dt >= from) out.push(dt);
    return true;
  };
  const byday = r.BYDAY ? r.BYDAY.split(',') : null;

  if (r.FREQ === 'DAILY') {
    for (let dt = start; dt <= until && n < count; dt = addDays(dt, interval)) push(dt);
  } else if (r.FREQ === 'WEEKLY') {
    const days = (byday || [DAYS[start.getUTCDay()]]).map((d) => DAYS.indexOf(d.slice(-2)));
    // pondělí týdne, ve kterém akce začíná
    let weekStart = addDays(start, -((start.getUTCDay() + 6) % 7));
    weekStart = wall(weekStart.getUTCFullYear(), weekStart.getUTCMonth() + 1, weekStart.getUTCDate(), h, mi);
    for (let w = weekStart; w <= until && n < count; w = addDays(w, 7 * interval)) {
      for (const d of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) push(addDays(w, (d + 6) % 7));
    }
  } else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
    const step = r.FREQ === 'MONTHLY' ? interval : 12 * interval;
    for (let k = 0; ; k += step) {
      const y = start.getUTCFullYear() + Math.floor((start.getUTCMonth() + k) / 12);
      const mo = ((start.getUTCMonth() + k) % 12) + 1;
      if (wall(y, mo, 1) > until || n >= count || k > 1200) break;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const cands = [];
      if (byday) {
        for (const spec of byday) {
          const [, ord, dd] = spec.match(/^([+-]?\d*)([A-Z]{2})$/) || [];
          const wd = DAYS.indexOf(dd);
          const all = [];
          for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === wd) all.push(d);
          if (!ord) cands.push(...all);
          else { const o = +ord; const d = o > 0 ? all[o - 1] : all[all.length + o]; if (d) cands.push(d); }
        }
      } else {
        const d = r.BYMONTHDAY ? +r.BYMONTHDAY : start.getUTCDate();
        if (d <= dim) cands.push(d);
      }
      for (const d of cands.sort((a, b) => a - b)) push(wall(y, mo, d, h, mi));
    }
  }
  return out;
}

export async function collectIcal(source, ctx) {
  const raw = parseIcs(await fetchText(source.url));
  const today = todayWall();
  const from = parseWall(ctx.historyFrom);
  // pravidelné akce jen do konce (recurringMonths-1). dalšího měsíce
  const months = source.options?.recurringMonths ?? 2;
  const horizon = wall(today.getUTCFullYear(), today.getUTCMonth() + 1 + months, 1);

  const overrides = new Map(); // uid|recurrence-id → událost
  for (const ev of raw) {
    if (ev['RECURRENCE-ID']) {
      const rid = parseDate(ev['RECURRENCE-ID'][0]);
      if (rid) overrides.set(`${ev.UID?.[0].value}|${fmt(rid.dt, rid.allDay)}`, ev);
    }
  }

  const out = [];
  const make = (ev, s, durMs, allDay, recurring) => {
    if ((ev.STATUS?.[0].value || '').toUpperCase() === 'CANCELLED') return;
    const end = new Date(s.getTime() + durMs);
    out.push({
      uid: ev.UID?.[0].value || '',
      title: unescape(ev.SUMMARY?.[0].value || '').trim(),
      start: fmt(s, allDay),
      // u celodenních akcí je DTEND exkluzivní → poslední den akce
      end: allDay ? fmt(addDays(end, -1), true) : fmt(end),
      allDay,
      location: unescape(ev.LOCATION?.[0].value || '').trim(),
      description: stripHtml(unescape(ev.DESCRIPTION?.[0].value || '')),
      url: ev.URL?.[0].value || '',
      recurring,
    });
  };

  for (const ev of raw) {
    if (ev['RECURRENCE-ID']) continue;
    const s = ev.DTSTART && parseDate(ev.DTSTART[0]);
    if (!s) continue;
    const e = ev.DTEND ? parseDate(ev.DTEND[0]) : null;
    const durMs = e ? e.dt - s.dt : (s.allDay ? 86400000 : 3600000);
    if (!ev.RRULE) {
      if (s.dt >= from) make(ev, s.dt, durMs, s.allDay, false);
      continue;
    }
    const ex = new Set((ev.EXDATE || []).flatMap((x) => x.value.split(',').map((v) => {
      const p = parseDate({ value: v, params: x.params });
      return p ? fmt(p.dt, s.allDay) : '';
    })));
    for (const occ of expandRrule(ev.RRULE[0].value, s.dt, from, horizon)) {
      const key = fmt(occ, s.allDay);
      if (ex.has(key)) continue;
      const ov = overrides.get(`${ev.UID?.[0].value}|${key}`);
      if (ov) {
        const os = parseDate(ov.DTSTART[0]);
        const oe = ov.DTEND ? parseDate(ov.DTEND[0]) : null;
        make({ ...ev, ...ov }, os.dt, oe ? oe.dt - os.dt : durMs, os.allDay, true);
      } else make(ev, occ, durMs, s.allDay, true);
    }
  }
  return out;
}

// pro testy
export { parseIcs, expandRrule, parseDate, parseWall };
