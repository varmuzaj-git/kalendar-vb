// Ručně zadané akce ze souboru v config/manual (např. rozpis fotbalových zápasů).
import { readFile } from 'node:fs/promises';
import { fmt, parseWall } from '../lib.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;

export async function collectStatic(source) {
  const data = JSON.parse(await readFile(ROOT + source.file, 'utf8'));
  const d = data.defaults || {};
  return data.events.map((e) => {
    const allDay = e.start.length === 10;
    const end = e.end || (allDay ? e.start : fmt(new Date(parseWall(e.start).getTime() + (e.durationMinutes || d.durationMinutes || 120) * 60000)));
    return { uid: `${e.start}|${e.title}`, title: e.title, start: e.start, end, allDay, location: e.location || d.location || '', description: e.description || '', url: e.url || '', image: e.image || '', organizers: e.organizers, aiCategories: e.categories, sourceTags: e.tags, recurring: false };
  });
}
