// Státní svátky ČR (výpočet, bez externího zdroje).
import { wall, fmt, addDays, todayWall } from '../lib.mjs';

function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return wall(y, month, day);
}

const FIXED = [
  [1, 1, 'Den obnovy samostatného českého státu, Nový rok'], [5, 1, 'Svátek práce'], [5, 8, 'Den vítězství'],
  [7, 5, 'Den slovanských věrozvěstů Cyrila a Metoděje'], [7, 6, 'Den upálení mistra Jana Husa'],
  [9, 28, 'Den české státnosti'], [10, 28, 'Den vzniku samostatného československého státu'],
  [11, 17, 'Den boje za svobodu a demokracii'], [12, 24, 'Štědrý den'], [12, 25, '1. svátek vánoční'], [12, 26, '2. svátek vánoční'],
];

export async function collectHolidays() {
  const y0 = todayWall().getUTCFullYear();
  const out = [];
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    const list = FIXED.map(([m, d, t]) => [wall(y, m, d), t]);
    const easter = easterSunday(y);
    list.push([addDays(easter, -2), 'Velký pátek'], [addDays(easter, 1), 'Velikonoční pondělí']);
    for (const [dt, title] of list) {
      out.push({ uid: `svatek-${fmt(dt, true)}`, title, start: fmt(dt, true), end: fmt(dt, true), allDay: true, recurring: false });
    }
  }
  return out;
}
