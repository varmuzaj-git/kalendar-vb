// Ručně zadané akce z WordPressu (plugin „Kalendář akcí – ruční akce“, /wp-json/kalendar-vb/v1/akce).
import { fetchJson, fmt, parseWall } from '../lib.mjs';

export async function collectWpManual(source) {
  const list = await fetchJson(source.url);
  return list.map((a) => {
    const allDay = !a.time_from;
    const start = allDay ? a.date_from : `${a.date_from}T${a.time_from}`;
    let end;
    if (allDay) end = a.date_to && a.date_to >= a.date_from ? a.date_to : a.date_from;
    else if (a.time_to) end = `${a.date_to || a.date_from}T${a.time_to}`;
    else end = fmt(new Date(parseWall(start).getTime() + 2 * 3600000));
    if (end < start) end = start;
    return {
      uid: `wp-${a.id}`,
      title: a.title,
      start, end, allDay,
      location: a.location || '',
      description: a.description || '',
      url: a.url || '',
      image: a.image || '',
      organizers: a.organizers || [],
      aiCategories: a.categories || [],
      sourceTags: a.tags || [],
      recurring: false,
    };
  });
}
