// Sběr akcí ze všech zdrojů → public/data/events.json, status.json, akce.ics
// Spuštění: node scripts/collect.mjs [--only=<id>]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { normalize, hash, todayWall, addDays, fmt, parseWall, wallToUtc } from './lib.mjs';
import { collectIcal } from './adapters/ical.mjs';
import { collectTribe } from './adapters/tribe.mjs';
import { collectHolidays } from './adapters/holidays.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ADAPTERS = { ical: collectIcal, tribe: collectTribe, holidays: collectHolidays };
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(ROOT + p, 'utf8')); } catch { return fallback; } };
const sourcesCfg = await readJson('config/sources.json');
const catCfg = await readJson('config/categories.json');
const previous = await readJson('public/data/events.json', { events: [] });
const prevStatus = await readJson('public/data/status.json', { sources: [] });

const rx = (list) => (list || []).map((k) => new RegExp(k, 'i'));
const catRules = catCfg.categories.map((c) => ({ id: c.id, patterns: rx(c.keywords) }));
const tagRules = Object.entries(catCfg.tags || {}).map(([k, tag]) => ({ re: new RegExp(k, 'i'), tag }));
const compact = (s) => normalize(s).replace(/[^a-z0-9]/g, '');
const tagMap = new Map(catCfg.categories.flatMap((c) => [[compact(c.id), c.id], [compact(c.label), c.id]]));

/** #deti #kultura v popisu (hlavně pro vlastní Google kalendáře) → kategorie; štítky se z popisu odstraní. */
function extractHashTags(description) {
  const cats = new Set(), tags = new Set();
  const text = String(description || '').replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (m, sp, word) => {
    const id = tagMap.get(compact(word));
    if (id) cats.add(id); else tags.add(word.toLowerCase());
    return sp;
  }).trim();
  return { cats: [...cats], tags: [...tags], description: text };
}

function enrich(ev, source) {
  const { cats: hashCats, tags: hashTags, description } = extractHashTags(ev.description);
  const text = normalize(`${ev.title}\n${description}`);
  const cats = new Set(source.categories || []);
  for (const c of ev.sourceCategories || []) if (source.categoryMap?.[c]) cats.add(source.categoryMap[c]);
  if (hashCats.length) hashCats.forEach((c) => cats.add(c));
  else for (const r of catRules) if (r.patterns.some((p) => p.test(text))) cats.add(r.id);
  if (!cats.size) cats.add('ostatni');
  const tags = new Set([...hashTags, ...(ev.sourceTags || []).map((t) => t.toLowerCase())]);
  for (const r of tagRules) if (r.re.test(text)) tags.add(r.tag);
  const recurring = ev.recurring || rx(source.recurringTitles).some((p) => p.test(normalize(ev.title)));
  const out = {
    id: `${source.id}-${hash(`${ev.uid}|${ev.start}`)}`,
    source: source.id,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    location: ev.location || source.defaultLocation || '',
    url: ev.url || '',
    description,
    image: ev.image || '',
    recurring,
    categories: source.display === 'dayLabel' ? [] : [...cats],
    tags: [...tags],
  };
  for (const k of ['url', 'description', 'image', 'location']) if (!out[k]) delete out[k];
  return out;
}

const isExcluded = (title, source) => {
  const t = normalize(title).trim();
  return !t || rx(source.exclude).some((p) => p.test(t));
};

const today = todayWall();
const keepFrom = fmt(addDays(today, -365), true);
const all = [];
const status = [];

for (const source of sourcesCfg.sources) {
  if (source.enabled === false) continue;
  const prevOfSource = previous.events.filter((e) => e.source === source.id);
  const prevSt = prevStatus.sources.find((s) => s.id === source.id) || {};
  if (only && only !== source.id) { all.push(...prevOfSource); status.push(prevSt); continue; }
  try {
    const raw = await ADAPTERS[source.type](source);
    let excluded = 0;
    const fresh = [];
    for (const ev of raw) {
      if (isExcluded(ev.title, source)) { excluded++; continue; }
      fresh.push(enrich(ev, source));
    }
    // archiv: proběhlé akce, které zdroj už nevrací, si necháme (rok zpět)
    const ids = new Set(fresh.map((e) => e.id));
    const todayStr = fmt(today, true);
    const archived = prevOfSource.filter((e) => !ids.has(e.id) && e.end.slice(0, 10) < todayStr && !isExcluded(e.title, source));
    all.push(...fresh, ...archived);
    status.push({ id: source.id, ok: true, error: null, count: fresh.length, excluded, lastSuccess: new Date().toISOString() });
    // názvy vyloučených akcí záměrně nevypisujeme – logy veřejného repozitáře vidí kdokoli
    console.log(`✓ ${source.id}: ${fresh.length} akcí, vyloučeno ${excluded}, archiv ${archived.length}`);
  } catch (e) {
    // při chybě zdroje necháme jeho poslední známé akce
    all.push(...prevOfSource);
    status.push({ id: source.id, ok: false, error: String(e.message || e), count: prevOfSource.length, lastSuccess: prevSt.lastSuccess || null, failingSince: prevSt.ok === false ? prevSt.failingSince : new Date().toISOString() });
    console.error(`✗ ${source.id}: ${e.message || e}`);
  }
}

// deduplikace (stejný zdroj, název a začátek) + ořez starých akcí
const seen = new Set();
const events = all
  .filter((e) => e.end.slice(0, 10) >= keepFrom)
  .filter((e) => { const k = `${e.source}|${normalize(e.title)}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'cs'));

const publicSources = sourcesCfg.sources.filter((s) => s.enabled !== false)
  .map(({ id, name, fullName, color, link, display }) => ({ id, name, fullName, color, link: link || null, display: display || 'events' }));
const publicCats = catCfg.categories.map(({ id, label, color }) => ({ id, label, color }));

await mkdir(ROOT + 'public/data', { recursive: true });
await writeFile(ROOT + 'public/data/events.json', JSON.stringify({ calendarName: 'Kalendář akcí ve Valašské Bystřici', sources: publicSources, categories: publicCats, events }, null, 1) + '\n');
await writeFile(ROOT + 'public/data/status.json', JSON.stringify({ generatedAt: new Date().toISOString(), sources: status }, null, 1) + '\n');

// ---- .ics pro odběr ----------------------------------------------------------
const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
const icsUtc = (w) => wallToUtc(w).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const icsDate = (s) => s.replace(/-/g, '');
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const srcName = Object.fromEntries(publicSources.map((s) => [s.id, s.fullName]));
const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kalendar VB//CS', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'X-WR-CALNAME:Akce ve Valašské Bystřici', 'X-WR-TIMEZONE:Europe/Prague', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
for (const e of events) {
  if (e.source === 'svatky') continue;
  lines.push('BEGIN:VEVENT', `UID:${e.id}@kalendar-vb`, `DTSTAMP:${stamp}`);
  if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(fmt(addDays(parseWall(e.end), 1), true))}`);
  else lines.push(`DTSTART:${icsUtc(parseWall(e.start))}`, `DTEND:${icsUtc(parseWall(e.end))}`);
  lines.push(`SUMMARY:${icsEsc(e.title)}`);
  if (e.location) lines.push(`LOCATION:${icsEsc(e.location)}`);
  const desc = [e.description, e.url, `Zdroj: ${srcName[e.source]}`].filter(Boolean).join('\n\n');
  lines.push(`DESCRIPTION:${icsEsc(desc)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.categories.length) lines.push(`CATEGORIES:${e.categories.map(icsEsc).join(',')}`);
  lines.push('END:VEVENT');
}
lines.push('END:VCALENDAR');
await writeFile(ROOT + 'public/data/akce.ics', lines.map(fold).join('\r\n') + '\r\n');
console.log(`Celkem ${events.length} akcí.`);
