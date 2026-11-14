// Sloučení stejné akce z více zdrojů (např. Kateřinský jarmark u Pernických i ve zpravodaji).
// 1) stejný den + podobný název → stejná akce
// 2) stejný den, název se neshoduje, ale akce se mohou překrývat → rozhodne AI (výsledek v cache)
// Základem sloučené akce je záznam ze zdroje s nejvyšší prioritou; chybějící údaje se doplní z ostatních.
import { normalize } from './lib.mjs';
import { sameEvent } from './ai.mjs';

const STOP = new Set(['akce', 'obec', 'obce', 'valasska', 'valasske', 'bystrice', 'bystrici', 'spolecensky', 'spolecenskem', 'dome', 'pernickych', 'sobota', 'nedele', 'roku', 'tradicni', 'vsechny', 'srdecne', 'zveme']);
const tokens = (s) => new Set(normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));

function similar(a, b) {
  const A = tokens(a.title), B = tokens(b.title);
  if (!A.size || !B.size) return false;
  let common = 0;
  for (const t of A) if (B.has(t)) common++;
  return common / Math.min(A.size, B.size) >= 0.5;
}

const minutes = (s) => (s.length > 10 ? +s.slice(11, 13) * 60 + +s.slice(14, 16) : null);
function timesCompatible(a, b) {
  const x = minutes(a.start), y = minutes(b.start);
  return x === null || y === null || Math.abs(x - y) <= 150;
}

export async function mergeDuplicates(events, sources, { ai, mergeRules = [] }) {
  const prio = Object.fromEntries(sources.map((s) => [s.id, s.priority ?? 1]));
  const byDay = new Map();
  events.forEach((e, i) => {
    if (e.recurring || !e.categories.length) return; // pravidelné akce a svátky neslučujeme
    const d = e.start.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(i);
  });

  // union-find nad indexy
  const parent = events.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { parent[find(i)] = find(j); };

  // ruční pravidla: stejná akce rozložená do více dnů (např. pouť: 15. 8. U Pernických + 16. 8. farnost)
  const dayNum = (s) => Math.round(Date.parse(s.slice(0, 10)) / 86400000);
  for (const r of mergeRules) {
    const re = new RegExp(r.match, 'i');
    const hits = events.map((e, i) => i).filter((i) => !events[i].recurring && re.test(normalize(events[i].title)));
    for (let a = 0; a < hits.length; a++) for (let b = a + 1; b < hits.length; b++) {
      if (Math.abs(dayNum(events[hits[a]].start) - dayNum(events[hits[b]].start)) <= (r.withinDays ?? 1)) union(hits[a], hits[b]);
    }
  }

  for (const idx of byDay.values()) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const i = idx[a], j = idx[b], A = events[i], B = events[j];
        // stejný zdroj slučujeme jen u zpravodaje (stejná akce v několika vydáních)
        if ((A.source === B.source && A.source !== 'zpravodaj') || find(i) === find(j)) continue;
        if (!timesCompatible(A, B)) continue;
        if (similar(A, B)) { union(i, j); continue; }
        // AI jen pro páry, kde aspoň jeden pochází z textového zdroje (zpravodaj, weby souborů)
        const textual = ['zpravodaj', 'chaos', 'trojak'];
        if (ai && (textual.includes(A.source) || textual.includes(B.source)) && A.categories.some((c) => B.categories.includes(c))) {
          try { if (await sameEvent(A, B)) union(i, j); } catch (e) { console.error('  AI duplicity:', e.message); }
        }
      }
    }
  }

  const groups = new Map();
  events.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); });
  const out = [];
  let merged = 0;
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    merged += g.length - 1;
    g.sort((x, y) => (prio[y.source] ?? 1) - (prio[x.source] ?? 1));
    const base = { ...g[0] };
    // vícedenní spojení: od nejdřívějšího začátku do nejpozdějšího konce
    const days = new Set(g.map((x) => x.start.slice(0, 10)));
    if (days.size > 1) {
      const first = g.reduce((m, x) => (x.start < m.start ? x : m));
      const last = g.reduce((m, x) => (x.end > m.end ? x : m));
      base.allDay = g.every((x) => x.allDay);
      base.start = base.allDay ? first.start.slice(0, 10) : first.start;
      base.end = base.allDay ? last.end.slice(0, 10) : last.end;
    }
    for (const o of g.slice(1)) {
      if (days.size === 1 && base.allDay && !o.allDay && o.start.slice(0, 10) === base.start.slice(0, 10)) { base.start = o.start; base.end = o.end; base.allDay = false; }
      for (const k of ['location', 'url', 'image']) if (!base[k] && o[k]) base[k] = o[k];
      if (o.description && (!base.description || o.description.length > base.description.length * 1.5)) base.description = o.description;
      if (!base.altTitles) base.altTitles = [];
      if (normalize(o.title) !== normalize(base.title)) base.altTitles.push(o.title);
    }
    base.sources = [...new Set(g.flatMap((x) => x.sources || [x.source]))];
    base.categories = [...new Set(g.flatMap((x) => x.categories))].filter((c, _, arr) => c !== 'ostatni' || arr.length === 1);
    base.tags = [...new Set(g.flatMap((x) => x.tags || []))];
    base.organizers = [...new Set(g.flatMap((x) => x.organizers || []))];
    base.altTitles = [...new Set(base.altTitles)].filter((x) => normalize(x) !== normalize(base.title));
    if (!base.altTitles.length) delete base.altTitles;
    out.push(base);
  }
  if (merged) console.log(`Sloučeno duplicit: ${merged}`);
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'cs'));
}
