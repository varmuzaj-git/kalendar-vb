// AI (Groq, OpenAI-kompatibilní API): vytažení akcí z volného textu + rozhodování o duplicitách.
// Výsledky se ukládají do cache/ai.json (klíč = hash vstupu), takže se stejný text posílá jen jednou.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { hash, normalize } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE_FILE = ROOT + 'cache/ai.json';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const PROMPT_VERSION = 3;

function apiKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
  // místní vývoj: klíč ze souboru (nikdy se nevypisuje)
  try { return readFileSync(process.env.HOME + '/.config/groq.key', 'utf8').trim(); } catch { return ''; }
}
export const aiAvailable = () => !!apiKey();

let cache = null;
async function loadCache() {
  if (!cache) { try { cache = JSON.parse(await readFile(CACHE_FILE, 'utf8')); } catch { cache = {}; } }
  return cache;
}
export async function saveCache() {
  if (!cache) return;
  await mkdir(ROOT + 'cache', { recursive: true });
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(CACHE_FILE, JSON.stringify(sorted, null, 1) + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function chatJson(system, user) {
  const key = apiKey();
  if (!key) throw new Error('chybí GROQ_API_KEY');
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(90, Number(res.headers.get('retry-after')) || 20 * (attempt + 1));
      console.log(`  AI: ${res.status}, čekám ${wait} s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    calls++;
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  }
  throw new Error('Groq: příliš mnoho opakování');
}
export const aiCalls = () => calls;

const CATS = 'kultura|sport|deti|seniori|vzdelavani|obec|cirkev|ostatni';

/**
 * Vytáhne veřejné akce z textu. context = popis zdroje (např. „zpravodaj obce, vydání listopad 2026“).
 * images = seznam URL obrázků, které se v textu objevují jako [OBRÁZEK n] – AI vybere plakát.
 */
export async function extractEvents(text, { context, refDate, images = [] }) {
  const system = `Jsi pečlivý extraktor akcí pro kalendář obce Valašská Bystřice. Zdroj: ${context}. Dnešní datum zdroje: ${refDate}.
Vypiš VEŘEJNÉ akce s konkrétním datem (kulturní, sportovní, církevní, obecní, pro děti, pro seniory, představení, koncerty, plesy, jarmarky, zasedání zastupitelstva).
NEVYPISUJ: svoz odpadu, uzávěrky, úřední lhůty a úřední hodiny, jubilanty, úmrtí a jiné osobní údaje, soukromé události, obecné výzvy bez data.
Zahrň i akce, které už proběhly, pokud mají jasné datum.
Rok: když není uveden, odvoď ho z data zdroje (akce bývají v blízkém okolí data zdroje).
Nevymýšlej: chybí-li čas nebo místo, dej null. Název piš stručně a věcně (jak by byl v kalendáři), bez data.
${images.length ? 'Obrázky v textu jsou označené [OBRÁZEK n]. Pokud k akci patří plakát/obrázek ve stejném bloku textu, uveď jeho číslo v "image", jinak null.' : ''}
Odpověz jen JSON: {"events":[{"title":"","date":"YYYY-MM-DD","endDate":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"endTime":"HH:MM"|null,"location":null,"organizer":null,"summary":"1–2 věty","categories":["${CATS}"],"tags":["1–3 krátké štítky malými písmeny"],"image":null,"quote":"krátký DOSLOVNÝ úryvek ze zdroje, který obsahuje datum akce"}]}`;
  const c = await loadCache();
  const key = 'ex-' + hash(`${PROMPT_VERSION}|${MODEL}|${system}|${text}`);
  if (!c[key]) {
    const out = await chatJson(system, text);
    c[key] = { at: new Date().toISOString(), events: Array.isArray(out.events) ? out.events : [] };
  }
  // kontrola halucinací: úryvek musí ve zdroji opravdu být, datum musí být platné
  // porovnání bez interpunkce a zalomení: model občas nahradí konec řádku pomlčkou
  const flat = (x) => normalize(x).replace(/[^a-z0-9]+/g, ' ').trim();
  const hay = ` ${flat(text)} `;
  return c[key].events.filter((e) => {
    if (!/^\d{4}-\d\d-\d\d$/.test(e.date || '') || Number.isNaN(Date.parse(e.date))) return false;
    if (!e.title) return false;
    const raw = normalize(e.quote || '').replace(/\s+/g, ' ').trim();
    const q = flat(raw);
    // úryvek musí začínat na hranici slova (aby „2 2“ nenašlo „12 2“)
    return raw.length >= 4 && q.length > 0 && hay.includes(` ${q.slice(0, 60)}`);
  }).map((e) => ({ ...e, image: Number.isInteger(e.image) && images[e.image - 1] ? images[e.image - 1] : null }));
}

/** Jsou dvě akce ze stejného dne tatáž akce? (jen sporné páry; výsledek v cache) */
export async function sameEvent(a, b) {
  const c = await loadCache();
  const key = 'dup-' + hash(`${PROMPT_VERSION}|${a.title}|${a.start}|${a.location || ''}|${b.title}|${b.start}|${b.location || ''}`);
  if (c[key] === undefined) {
    const system = 'Rozhodni, zda dva záznamy z různých zdrojů popisují TUTÉŽ akci v obci Valašská Bystřice (stejný den). Např. „Divadelní podzim“ v sále a „Divadelní představení Kulky“ téhož dne v témže místě = ano. Různé typy akcí = ne. Odpověz JSON {"same":true|false}.';
    const fmtE = (e) => `název: ${e.title}\nzačátek: ${e.start}\nmísto: ${e.location || '?'}\npopis: ${(e.description || '').slice(0, 300)}`;
    const out = await chatJson(system, `A)\n${fmtE(a)}\n\nB)\n${fmtE(b)}`);
    c[key] = !!out.same;
  }
  return c[key];
}
