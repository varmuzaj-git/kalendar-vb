// The Events Calendar (WordPress) – veřejné REST API /wp-json/tribe/events/v1/events
import { fetchJson, decodeHtml, stripHtml, truncate, todayWall, addDays, fmt } from '../lib.mjs';

export async function collectTribe(source) {
  const from = fmt(addDays(todayWall(), -400), true);
  let url = `${source.url}?per_page=50&start_date=${from}%2000:00:00&status=publish`;
  const out = [];
  for (let page = 0; url && page < 20; page++) {
    const data = await fetchJson(url);
    for (const e of data.events || []) {
      out.push({
        uid: String(e.id),
        title: decodeHtml(e.title).trim(),
        start: e.all_day ? e.start_date.slice(0, 10) : e.start_date.slice(0, 16).replace(' ', 'T'),
        end: e.all_day ? e.end_date.slice(0, 10) : e.end_date.slice(0, 16).replace(' ', 'T'),
        allDay: !!e.all_day,
        location: decodeHtml(e.venue?.venue || ''),
        description: truncate(stripHtml(e.excerpt || e.description || '')),
        url: e.url,
        image: e.image?.sizes?.medium?.url || e.image?.url || '',
        sourceCategories: (e.categories || []).map((c) => c.slug),
        sourceTags: (e.tags || []).map((t) => decodeHtml(t.name)),
        recurring: false,
      });
    }
    url = data.next_rest_url || null;
  }
  return out;
}
