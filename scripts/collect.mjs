// Sběr akcí ze všech zdrojů → public/data/events.json, status.json, akce.ics
// Spuštění: node scripts/collect.mjs [--only=<id>]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { normalize, hash, todayWall, addDays, fmt, parseWall, wallToUtc } from './lib.mjs';
import { collectIcal } from './adapters/ical.mjs';
import { collectTribe } from './adapters/tribe.mjs';
import { collectHolidays } from './adapters/holidays.mjs';
import { collectZpravodaj, collectAiHtml, collectAiWp } from './adapters/ai-sources.mjs';
import { saveCache, aiAvailable, aiCalls } from './ai.mjs';
import { mergeDuplicates } from './dedupe.mjs';
import { collectStatic } from './adapters/static.mjs';
import { collectWpManual } from './adapters/wp-manual.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ADAPTERS = { ical: collectIcal, tribe: collectTribe, holidays: collectHolidays, zpravodaj: collectZpravodaj, 'ai-html': collectAiHtml, 'ai-wp': collectAiWp, static: collectStatic, 'wp-manual': collectWpManual };
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(ROOT + p, 'utf8')); } catch { return fallback; } };
const sourcesCfg = await readJson('config/sources.json');
const catCfg = await readJson('config/categories.json');
const orgCfg = await readJson('config/organizers.json', { organizers: [] });
// nesloučené akce po zdrojích z minulého běhu (archiv a záloha při výpadku zdroje)
const previous = await readJson('cache/raw-events.json', { events: [] });
const prevStatus = await readJson('public/data/status.json', { sources: [] });

const rx = (list) => (list || []).map((k) => new RegExp(k, 'i'));
const orgRules = orgCfg.organizers.map((o) => ({ ...o, re: rx(o.match) }));
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

// opravy názvů ve všech zdrojích (např. „Joga“ → „Jóga“); klíč = regex bez ohledu na velikost písmen
const titleFixes = Object.entries(sourcesCfg.titleFixes || {}).map(([k, v]) => [new RegExp(k, 'giu'), v]);
const fixTitle = (s) => titleFixes.reduce((acc, [re, v]) => acc.replace(re, (m) => (m[0] === m[0].toLowerCase() ? v.toLowerCase() : v)), s);

function enrich(ev, source) {
  ev = { ...ev, title: fixTitle(ev.title), description: fixTitle(ev.description || '') };
  const { cats: hashCats, tags: hashTags, description } = extractHashTags(ev.description);
  const text = normalize(`${ev.title}\n${description}`);
  const cats = new Set(source.categories || []);
  for (const c of ev.sourceCategories || []) if (source.categoryMap?.[c]) cats.add(source.categoryMap[c]);
  for (const c of ev.aiCategories || []) if (tagMap.has(compact(c))) cats.add(tagMap.get(compact(c)));
  if (hashCats.length) hashCats.forEach((c) => cats.add(c));
  else for (const r of catRules) if (r.patterns.some((p) => p.test(text))) cats.add(r.id);
  for (const r of source.categoryRules || []) {
    if (r.recurringOnly && !recurringOf(ev, source)) continue;
    if (!new RegExp(r.title, 'i').test(normalize(ev.title))) continue;
    (r.remove || []).forEach((c) => cats.delete(c));
    (r.add || []).forEach((c) => cats.add(c));
  }
  if (cats.size > 1) cats.delete('ostatni');
  if (!cats.size) cats.add('ostatni');
  const tags = new Set([...hashTags, ...(ev.sourceTags || []).map((t) => t.toLowerCase())]);
  for (const r of tagRules) if (r.re.test(text)) tags.add(r.tag);
  // podle názvu jen u akcí s časem (celodenní „Troják“ = vystoupení, ne zkouška)
  const recurring = recurringOf(ev, source);
  const orgText = normalize(`${ev.title}\n${ev.organizerHint || ''}`);
  const where = normalize(ev.location || source.defaultLocation || '');
  const noOrg = rx(orgCfg.noOrganizer).some((p) => p.test(orgText));
  const organizers = Array.isArray(ev.organizers) ? ev.organizers : noOrg ? [] : orgRules.filter((o) => (o.sources || []).includes(source.id) || o.re.some((p) => p.test(orgText))
    || (o.rules || []).some((r) => rx(r.match).some((p) => p.test(orgText)) && (!r.location || new RegExp(r.location, 'i').test(where)))).map((o) => o.id);
  const out = {
    organizers,
    id: `${source.id}-${hash(`${ev.uid}|${ev.start}`)}`,
    source: source.id,
    sources: [source.id],
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
    // štítky bez duplicit (bez ohledu na velikost písmen; přednost má tvar z pravidel)
    tags: [...new Map([...tags].reverse().map((x) => [x.toLowerCase(), x])).values()].reverse(),
  };
  for (const k of ['url', 'description', 'image', 'location']) if (!out[k]) delete out[k];
  return out;
}

function recurringOf(ev, source) {
  // podle názvu jen u akcí s časem (celodenní „Troják“ = vystoupení, ne zkouška)
  return ev.recurring || (!ev.allDay && rx(source.recurringTitles).some((p) => p.test(normalize(ev.title))));
}

// exclude = vždy; excludeRecurring = jen pravidelné výskyty (kroužky, zkoušky), jednorázové akce se stejným názvem zůstanou
const isExcluded = (ev, source) => {
  const t = normalize(ev.title).trim();
  if (!t || rx(source.exclude).some((p) => p.test(t))) return true;
  return rx(source.excludeRecurring).some((p) => p.test(t)) && recurringOf(ev, source);
};

const today = todayWall();
// historie: od data v konfiguraci (sources.json → historyFrom), nejvýš rok zpět
const yearAgo = fmt(addDays(today, -365), true);
const keepFrom = sourcesCfg.historyFrom && sourcesCfg.historyFrom > yearAgo ? sourcesCfg.historyFrom : yearAgo;
const ctx = { historyFrom: keepFrom, today: fmt(today, true) };
const all = [];
const status = [];

for (const source of sourcesCfg.sources) {
  if (source.enabled === false) continue;
  const prevOfSource = previous.events.filter((e) => e.source === source.id);
  const prevSt = prevStatus.sources.find((s) => s.id === source.id) || {};
  if (only && only !== source.id) { all.push(...prevOfSource); status.push(prevSt); continue; }
  try {
    const raw = await ADAPTERS[source.type](source, ctx);
    let excluded = 0;
    const fresh = [];
    for (const ev of raw) {
      if (isExcluded(ev, source)) { excluded++; continue; }
      fresh.push(enrich(ev, source));
    }
    // archiv: proběhlé akce, které zdroj už nevrací, si necháme (rok zpět)
    const ids = new Set(fresh.map((e) => e.id));
    const todayStr = fmt(today, true);
    const archived = prevOfSource.filter((e) => !ids.has(e.id) && e.end.slice(0, 10) < todayStr && !isExcluded(e, source));
    all.push(...fresh, ...archived);
    status.push({ id: source.id, ok: true, error: null, count: fresh.length, excluded, lastSuccess: new Date().toISOString() });
    // názvy vyloučených akcí záměrně nevypisujeme – logy veřejného repozitáře vidí kdokoli
    console.log(`✓ ${source.id}: ${fresh.length} akcí, vyloučeno ${excluded}, archiv ${archived.length}`);
  } catch (e) {
    // při chybě zdroje necháme jeho poslední známé akce (bez nově vyloučených)
    all.push(...prevOfSource.filter((e) => !isExcluded(e, source)));
    status.push({ id: source.id, ok: false, error: String(e.message || e), count: prevOfSource.length, lastSuccess: prevSt.lastSuccess || null, failingSince: prevSt.ok === false ? prevSt.failingSince : new Date().toISOString() });
    console.error(`✗ ${source.id}: ${e.message || e}`);
  }
}

// deduplikace (stejný zdroj, název a začátek) + ořez starých akcí
const seen = new Set();
let events = all
  .filter((e) => e.end.slice(0, 10) >= keepFrom)
  .filter((e) => { const k = `${e.source}|${normalize(e.title)}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'cs'));

await mkdir(ROOT + 'cache', { recursive: true });
await writeFile(ROOT + 'cache/raw-events.json', JSON.stringify({ events }, null, 0).replace(/},{/g, '},\n{') + '\n');

// stejná akce z více zdrojů → jedna (pravidla podobnosti + AI u sporných párů)
events = await mergeDuplicates(events, sourcesCfg.sources, { ai: aiAvailable(), mergeRules: sourcesCfg.mergeRules || [] });
await saveCache();
if (aiCalls()) console.log(`AI: ${aiCalls()} dotazů`);

const publicSources = sourcesCfg.sources.filter((s) => s.enabled !== false)
  .map(({ id, name, fullName, color, link, display, organizer }) => ({ id, name, fullName, color, link: link || null, display: display || 'events', organizer: organizer !== false }));
const publicOrgs = orgCfg.organizers.map(({ id, name, color, link }) => ({ id, name, color, link: link || null }));
const publicCats = catCfg.categories.map(({ id, label, color }) => ({ id, label, color }));

await mkdir(ROOT + 'public/data', { recursive: true });
await writeFile(ROOT + 'public/data/events.json', JSON.stringify({ calendarName: 'Kalendář akcí ve Valašské Bystřici', sources: publicSources, organizers: publicOrgs, categories: publicCats, events }, null, 1) + '\n');
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
  const desc = [e.description, e.url, `Zdroj: ${(e.sources || [e.source]).map((s) => srcName[s]).join(', ')}`].filter(Boolean).join('\n\n');
  lines.push(`DESCRIPTION:${icsEsc(desc)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.categories.length) lines.push(`CATEGORIES:${e.categories.map(icsEsc).join(',')}`);
  lines.push('END:VEVENT');
}
lines.push('END:VCALENDAR');
await writeFile(ROOT + 'public/data/akce.ics', lines.map(fold).join('\r\n') + '\r\n');
console.log(`Celkem ${events.length} akcí.`);
