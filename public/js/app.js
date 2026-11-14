// Kalendář akcí VB – frontend (bez knihoven). Data: data/events.json, časy jsou místní (Europe/Prague).
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const WD = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

  const params = new URLSearchParams(location.search);
  if (params.has('embed') || window.self !== window.top) document.body.classList.add('embedded');

  const state = { q: '', cats: new Set(), srcs: new Set(), recurring: true, view: 'list', month: null, limit: 60 };
  let DATA, SRC, CAT, holidays;
  const todayStr = ymd(new Date());

  const dateOf = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const timeOf = (s) => (s.length > 10 ? s.slice(11, 16) : '');
  const dayLabel = (s) => { const d = dateOf(s); return `${WD[d.getDay()]} ${d.getDate()}. ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };

  function eventColor(e) { return CAT[e.categories[0]]?.color || SRC[e.source]?.color || '#888'; }

  function matches(e) {
    if (SRC[e.source]?.display === 'dayLabel') return false;
    if (!state.recurring && e.recurring) return false;
    if (state.srcs.size && !state.srcs.has(e.source)) return false;
    if (state.cats.size && !e.categories.some((c) => state.cats.has(c))) return false;
    if (state.q) {
      const hay = norm(`${e.title} ${e.description || ''} ${e.location || ''} ${(e.tags || []).join(' ')}`);
      if (!norm(state.q).split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  // ---- seznam ----
  function eventHtml(e) {
    const t = e.allDay ? (e.end > e.start ? `do ${dateOf(e.end).getDate()}. ${dateOf(e.end).getMonth() + 1}.` : 'celý den') : `${timeOf(e.start)}${timeOf(e.end) && e.end.slice(0, 10) === e.start.slice(0, 10) ? '–' + timeOf(e.end) : ''}`;
    const title = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
    const cats = e.categories.filter((c) => c !== 'ostatni').map((c) => `<span class="badge cat" style="--c:${CAT[c]?.color}">${esc(CAT[c]?.label || c)}</span>`).join(' ');
    const tags = (e.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join(' ');
    const src = SRC[e.source];
    const srcHtml = src?.link ? `<a href="${esc(src.link)}" target="_blank" rel="noopener">${esc(src.name)}</a>` : esc(src?.name || e.source);
    return `<article class="ev" style="--c:${eventColor(e)}">
      <div class="time">${esc(t)}</div>
      <div>
        <div class="title">${title}</div>
        <div class="meta">${e.location ? `<span>📍 ${esc(e.location)}</span>` : ''}<span>${srcHtml}</span>${e.recurring ? '<span>↻ pravidelně</span>' : ''}</div>
        ${cats || tags ? `<div class="meta">${cats} ${tags}</div>` : ''}
        ${e.description ? `<details><summary>Podrobnosti</summary><p class="desc">${esc(e.description)}</p></details>` : ''}
      </div>
    </article>`;
  }

  function renderList(list) {
    const upcoming = list.filter((e) => e.end.slice(0, 10) >= todayStr);
    if (!upcoming.length) return '<p class="muted">Žádné nadcházející akce neodpovídají výběru.</p>';
    const shown = upcoming.slice(0, state.limit);
    const byDay = new Map();
    for (const e of shown) {
      const k = e.start.slice(0, 10) < todayStr ? todayStr : e.start.slice(0, 10); // probíhající vícedenní akce dnes
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
    let html = '';
    for (const [day, evs] of byDay) {
      const hl = holidays.get(day);
      html += `<section class="day"><h3>${day === todayStr ? '<span class="today">dnes</span>' : ''}<span>${esc(dayLabel(day))}</span>${hl ? `<span class="holiday">${esc(hl)}</span>` : ''}</h3>${evs.map(eventHtml).join('')}</section>`;
    }
    if (upcoming.length > shown.length) html += `<p class="more"><button type="button" class="btn ghost" id="more">Zobrazit další akce (${upcoming.length - shown.length})</button></p>`;
    return html;
  }

  // ---- měsíc ----
  function renderMonth(list) {
    const m = state.month;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const byDay = new Map();
    for (const e of list) {
      for (let d = dateOf(e.start), end = dateOf(e.end), i = 0; d <= end && i < 62; d.setDate(d.getDate() + 1), i++) {
        const k = ymd(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e);
      }
    }
    let cells = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'].map((w) => `<div class="wd">${w}</div>`).join('');
    const d = new Date(start);
    for (let i = 0; i < 42; i++, d.setDate(d.getDate() + 1)) {
      if (i === 35 && d.getMonth() !== m.getMonth()) break;
      const k = ymd(d), evs = byDay.get(k) || [], hl = holidays.get(k);
      cells += `<div class="cell${d.getMonth() !== m.getMonth() ? ' other' : ''}${k === todayStr ? ' is-today' : ''}">
        <span class="n">${d.getDate()}</span>${hl ? `<span class="hl">${esc(hl)}</span>` : ''}
        ${evs.map((e) => `<button type="button" class="mev${e.recurring ? ' rec' : ''}" style="--c:${eventColor(e)}" data-day="${k}" title="${esc(e.title)}"><span class="t">${e.allDay ? '' : timeOf(e.start) + ' '}</span>${esc(e.title)}</button>`).join('')}
      </div>`;
    }
    return `<div class="mhead"><button type="button" id="prev" aria-label="Předchozí měsíc">‹</button><h3>${MONTHS[m.getMonth()]} ${m.getFullYear()}</h3><button type="button" id="next" aria-label="Další měsíc">›</button></div>
      <div class="grid">${cells}</div><div class="mdetail" id="mdetail"></div>`;
  }

  function render() {
    const list = DATA.events.filter(matches);
    $('#out').innerHTML = state.view === 'list' ? renderList(list) : renderMonth(list);
    $('#reset').hidden = !(state.q || state.cats.size || state.srcs.size || !state.recurring);
    document.querySelectorAll('.views button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    $('#more')?.addEventListener('click', () => { state.limit += 60; render(); });
    $('#prev')?.addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); });
    $('#next')?.addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); });
    document.querySelectorAll('.mev').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.day;
      const evs = list.filter((e) => e.start.slice(0, 10) <= k && e.end.slice(0, 10) >= k);
      $('#mdetail').innerHTML = `<section class="day"><h3><span>${esc(dayLabel(k))}</span></h3>${evs.map(eventHtml).join('')}</section>`;
      $('#mdetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      postHeight();
    }));
    postHeight();
  }

  function chips(el, items, set) {
    el.innerHTML = (el.querySelector('.lbl')?.outerHTML || '') + items.map((i) => `<button type="button" class="chip" aria-pressed="false" data-id="${esc(i.id)}" style="--c:${i.color}"><span class="dot"></span>${esc(i.label)}</button>`).join('');
    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id;
      set.has(id) ? set.delete(id) : set.add(id);
      b.setAttribute('aria-pressed', String(set.has(id)));
      state.limit = 60; render();
    }));
  }

  // výška pro vložení do <iframe> na jiném webu
  let lastH = 0;
  function postHeight() {
    if (window.parent === window) return;
    requestAnimationFrame(() => {
      const h = document.documentElement.scrollHeight;
      if (h !== lastH) { lastH = h; window.parent.postMessage({ type: 'kalendar-vb-height', height: h }, '*'); }
    });
  }
  new ResizeObserver(postHeight).observe(document.body);

  async function init() {
    try {
      DATA = await (await fetch('data/events.json', { cache: 'no-cache' })).json();
    } catch {
      $('#out').innerHTML = '<p>Akce se nepodařilo načíst. Zkuste to prosím později.</p>';
      return;
    }
    SRC = Object.fromEntries(DATA.sources.map((s) => [s.id, s]));
    CAT = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));
    holidays = new Map(DATA.events.filter((e) => SRC[e.source]?.display === 'dayLabel').map((e) => [e.start.slice(0, 10), e.title]));
    const used = new Set(DATA.events.flatMap((e) => e.categories));
    chips($('#cats'), DATA.categories.filter((c) => used.has(c.id)), state.cats);
    chips($('#srcs'), DATA.sources.filter((s) => s.display !== 'dayLabel').map((s) => ({ id: s.id, label: s.name, color: s.color })), state.srcs);
    state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    let t;
    $('#q').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { state.q = ev.target.value.trim(); state.limit = 60; render(); }, 150); });
    $('#showRecurring').addEventListener('change', (ev) => { state.recurring = ev.target.checked; render(); });
    document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
    $('#reset').addEventListener('click', () => {
      state.q = ''; $('#q').value = ''; state.cats.clear(); state.srcs.clear(); state.recurring = true; $('#showRecurring').checked = true;
      document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      render();
    });

    const icsUrl = new URL('data/akce.ics', location.href).href;
    $('#webcal').href = icsUrl.replace(/^https?:/, 'webcal:');
    $('#copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(icsUrl); $('#copy').textContent = 'Zkopírováno ✓'; }
      catch { prompt('Odkaz na kalendář:', icsUrl); }
    });

    const srcList = DATA.sources.filter((s) => s.display !== 'dayLabel')
      .map((s) => (s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.fullName)}</a>` : esc(s.fullName)));
    $('#sources').innerHTML = `Akce se automaticky přebírají ze zdrojů: ${srcList.join(', ')}.`;
    try {
      const st = await (await fetch('data/status.json', { cache: 'no-cache' })).json();
      const d = new Date(st.generatedAt);
      $('#updated').textContent = `Aktualizováno ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} v ${pad(d.getHours())}:${pad(d.getMinutes())}.`;
    } catch { /* bez stavu */ }
    render();
  }
  init();
})();
