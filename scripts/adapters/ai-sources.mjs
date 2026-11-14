// Zdroje, kde akce nejsou strukturované a čte je AI:
//   zpravodaj  – měsíční PDF zpravodaj obce (vismo RSS)
//   ai-html    – stránka s bloky textu a plakáty (např. divadlochaos.cz)
//   ai-wp      – články WordPressu (např. vstrojak.cz), plakát = náhledový obrázek
import { fetchText, fetchJson, decodeHtml, stripHtml, truncate, fmt, addDays, parseWall } from '../lib.mjs';
import { extractEvents, aiAvailable } from '../ai.mjs';

const UA = { headers: { 'User-Agent': 'KalendarVB/1.0' } };

/** Událost od AI → společný formát adaptérů. */
function toEvent(e, extra = {}) {
  const allDay = !e.time;
  const start = allDay ? e.date : `${e.date}T${e.time}`;
  let end;
  if (allDay) end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
  else if (e.endTime && e.endTime > e.time) end = `${e.endDate || e.date}T${e.endTime}`;
  else end = fmt(new Date(parseWall(start).getTime() + 2 * 3600000)); // bez konce → 2 h
  return {
    uid: `${e.date}|${e.title}`,
    title: String(e.title).trim(),
    start, end, allDay,
    location: e.location || '',
    description: e.summary || '',
    aiCategories: (e.categories || []).filter(Boolean),
    sourceTags: (e.tags || []).slice(0, 4),
    image: e.image || extra.image || '',
    url: extra.url || '',
    recurring: false,
  };
}

const inWindow = (e, from) => e.date >= from;

function chunkText(parts, max = 7000) {
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > max) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---- Zpravodaj (PDF) ---------------------------------------------------------
const MONTHS = ['leden', 'unor', 'brezen', 'duben', 'kveten', 'cerven', 'cervenec', 'srpen', 'zari', 'rijen', 'listopad', 'prosinec'];
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function collectZpravodaj(source, { historyFrom }) {
  if (!aiAvailable()) throw new Error('AI není k dispozici (GROQ_API_KEY)');
  const { extractText, getDocumentProxy } = await import('unpdf');
  // stránka archivu zpravodaje: <a href="/assets/File.ashx?...">Zpravodaj červenec, srpen 2026</a>
  const page = await fetchText(source.url);
  const issues = [];
  for (const m of page.matchAll(/<a href="([^"]*File\.ashx[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = stripHtml(m[2]);
    const mm = norm(title).match(/^zpravodaj\s+([a-z]+)[^0-9]*(\d{4})/);
    if (!mm) continue;
    const month = MONTHS.indexOf(mm[1]) + 1;
    if (!month) continue;
    issues.push({ title, year: +mm[2], month, pdf: new URL(decodeHtml(m[1]), source.url).href, link: source.link || source.url });
  }
  if (!issues.length) throw new Error('na stránce archivu nejsou žádná vydání');
  const out = [];
  for (const is of issues) {
    // vydání z měsíce před začátkem historie ještě obsahuje pozvánky do něj
    const [fy, fm] = historyFrom.split('-').map(Number);
    if (is.year * 12 + is.month < fy * 12 + fm - 1) continue;
    const buf = new Uint8Array(await (await fetch(is.pdf, UA)).arrayBuffer());
    const { text } = await extractText(await getDocumentProxy(buf), { mergePages: false });
    const pages = text.map((t, i) => `--- strana ${i + 1} ---\n${t}`);
    const refDate = `${is.year}-${String(is.month).padStart(2, '0')}-01`;
    let n = 0;
    for (const chunk of chunkText(pages, 7000)) {
      const evs = await extractEvents(chunk, { context: `${source.fullName}, vydání ${is.title}`, refDate });
      for (const e of evs) if (inWindow(e, historyFrom)) { out.push(toEvent(e, { url: is.link || is.pdf })); n++; }
    }
    console.log(`  ${is.title}: ${n} akcí`);
  }
  return out;
}

// ---- HTML stránka s bloky (divadlo CHAOS) -----------------------------------
function htmlToBlocks(html, baseUrl, skipImg) {
  const images = [];
  const body = html.replace(/<(script|style|nav|header|footer|noscript)[\s\S]*?<\/\1>/gi, '');
  const parts = body.split(/<section\b/i).slice(1).map((sec) => {
    const withImgs = sec.replace(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi, (_, src) => {
      const url = new URL(decodeHtml(src), baseUrl).href;
      if (skipImg && new RegExp(skipImg, 'i').test(url)) return ' ';
      images.push(url);
      return ` [OBRÁZEK ${images.length}] `;
    });
    return stripHtml('<x' + withImgs);
  }).filter((t) => t.replace(/\[OBRÁZEK \d+\]/g, '').trim().length > 30);
  return { parts, images };
}

export async function collectAiHtml(source, { historyFrom, today }) {
  if (!aiAvailable()) throw new Error('AI není k dispozici (GROQ_API_KEY)');
  const html = await fetchText(source.url);
  const { parts, images } = htmlToBlocks(html, source.url, source.options?.skipImages);
  const out = [];
  // každý blok zvlášť: plakát pak patří jen k akci ze stejného bloku
  const dateLike = /\b\d{1,2}\.\s*(\d{1,2}\.|[a-zA-Zá-žÁ-Ž]+)\s*(20\d\d)?/;
  for (const part of parts) {
    if (!dateLike.test(part)) continue;
    const local = [...new Set([...part.matchAll(/\[OBRÁZEK (\d+)\]/g)].map((m) => +m[1]))];
    const text = part.replace(/\[OBRÁZEK (\d+)\]/g, (_, n) => `[OBRÁZEK ${local.indexOf(+n) + 1}]`).slice(0, 6000);
    const evs = await extractEvents(text, { context: source.fullName, refDate: today, images: local.map((n) => images[n - 1]) });
    for (const e of evs) if (inWindow(e, historyFrom)) out.push(toEvent(e, { url: source.link || source.url }));
  }
  return out;
}

// ---- WordPress články (Troják) ----------------------------------------------
export async function collectAiWp(source, { historyFrom }) {
  if (!aiAvailable()) throw new Error('AI není k dispozici (GROQ_API_KEY)');
  // články publikované od ~2 měsíců před začátkem historie (pozvánky vycházejí předem)
  const after = fmt(addDays(parseWall(historyFrom), -60), true);
  const posts = await fetchJson(`${source.url}/wp-json/wp/v2/posts?per_page=50&after=${after}T00:00:00&_embed=wp:featuredmedia`);
  const out = [];
  for (const p of posts) {
    const img = p._embedded?.['wp:featuredmedia']?.[0];
    const image = img?.media_details?.sizes?.medium_large?.source_url || img?.media_details?.sizes?.large?.source_url || img?.source_url || '';
    const text = `Název článku: ${decodeHtml(p.title.rendered)}\nPublikováno: ${p.date.slice(0, 10)}\n\n${truncate(stripHtml(p.content.rendered), 5000)}`;
    const evs = await extractEvents(text, { context: `${source.fullName} – článek na webu`, refDate: p.date.slice(0, 10) });
    for (const e of evs) if (inWindow(e, historyFrom)) out.push(toEvent(e, { url: p.link, image }));
  }
  return out;
}
