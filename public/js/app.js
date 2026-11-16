// Kalendář akcí VB – frontend (bez knihoven). Data: data/events.json, časy jsou místní (Europe/Prague).
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const WD = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
  const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
  const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
  const MAX_PILLS = 4;

  if (new URLSearchParams(location.search).has('embed') || window.self !== window.top) document.body.classList.add('embedded');

  const state = { q: '', cats: new Set(), srcs: new Set(), recurring: true, past: false, month: null, limit: 80, months: 2 };
  // nadcházející akce: seznam končí na konci `months`-tého měsíce (aktuální + další), pak odkaz „Zobrazit další akce – Měsíc rok“
  const monthEnd = (n) => { const t = new Date(); return ymd(new Date(t.getFullYear(), t.getMonth() + n, 1)); }; // první den měsíce za hranicí
  const monthsUntil = (k) => { const t = new Date(), [y, m] = k.split('-').map(Number); return (y - t.getFullYear()) * 12 + (m - 1 - t.getMonth()) + 1; };
  let DATA, SRC, CAT, ORG, holidays;
  const todayStr = ymd(new Date());

  const dateOf = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const timeOf = (s) => (s.length > 10 ? s.slice(11, 16) : '');
  const dayLabel = (s) => { const d = dateOf(s); return `${WD[d.getDay()]} ${d.getDate()}. ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
  const srcsOf = (e) => e.sources || [e.source];
  const eventColor = (e) => ORG[(e.organizers || [])[0]]?.color || CAT[e.categories[0]]?.color || '#888';

  function matches(e) {
    if (SRC[e.source]?.display === 'dayLabel') return false;
    if (!state.recurring && e.recurring) return false;
    if (state.srcs.size && !(e.organizers || []).some((o) => state.srcs.has(o))) return false;
    if (state.cats.size && !e.categories.some((c) => state.cats.has(c))) return false;
    if (state.q) {
      const hay = norm(`${e.title} ${(e.altTitles || []).join(' ')} ${e.description || ''} ${e.location || ''} ${(e.tags || []).join(' ')}`);
      if (!norm(state.q).split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  // ---- karta akce ----
  function timeText(e) {
    if (e.allDay) return e.end > e.start ? `do ${dateOf(e.end).getDate()}. ${dateOf(e.end).getMonth() + 1}.` : 'celý den';
    const sameDay = e.end.slice(0, 10) === e.start.slice(0, 10);
    return `${timeOf(e.start)}${sameDay && timeOf(e.end) ? '–' + timeOf(e.end) : ''}`;
  }
  function eventHtml(e) {
    const title = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
    const link = (o) => (o?.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o?.name || ''));
    const org = (e.organizers || []).map((id) => link(ORG[id])).join(' · ');
    const info = 'zdroj: ' + srcsOf(e).map((id) => link({ name: SRC[id]?.name || id, link: SRC[id]?.link })).join(', ');
    const cats = e.categories.filter((c) => c !== 'ostatni').map((c) => `<span class="badge cat" style="--c:${CAT[c]?.color}">${esc(CAT[c]?.label || c)}</span>`).join(' ');
    const tags = (e.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join(' ');
    const past = e.end.slice(0, 10) < todayStr;
    return `<article class="card ev${past ? ' past' : ''}" style="--c:${eventColor(e)}">
      <div class="time">${esc(timeText(e))}</div>
      <div>
        <div class="title">${title}</div>
        <div class="meta">${org ? `<span><strong>${org}</strong></span>` : ''}${e.location ? `<span>📍 ${esc(e.location)}</span>` : ''}${e.recurring ? '<span>↻ pravidelně</span>' : ''}<span class="src">${info}</span></div>
        ${cats || tags ? `<div class="meta">${cats} ${tags}</div>` : ''}
        ${e.image ? `<a class="poster" href="${esc(e.image)}" target="_blank" rel="noopener"><img src="${esc(e.image)}" alt="Plakát: ${esc(e.title)}" loading="lazy"></a>` : ''}
        ${e.description || e.altTitles ? `<details><summary>Podrobnosti</summary>${e.altTitles ? `<p class="desc muted">Uváděno také jako: ${e.altTitles.map(esc).join(', ')}</p>` : ''}${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}</details>` : ''}
      </div>
    </article>`;
  }

  // ---- seznam ----
  function renderList(list) {
    const shownList = state.past ? list.filter((e) => e.end.slice(0, 10) < todayStr).reverse() : list.filter((e) => e.end.slice(0, 10) >= todayStr);
    if (!shownList.length) return `<div class="card empty muted">${state.past ? 'Žádné proběhlé akce neodpovídají výběru.' : 'Žádné nadcházející akce neodpovídají výběru.'}</div>`;
    const cutoff = monthEnd(state.months);
    const shown = state.past ? shownList.slice(0, state.limit) : shownList.filter((e) => e.start.slice(0, 10) < cutoff);
    const nextEv = state.past ? null : shownList.find((e) => e.start.slice(0, 10) >= cutoff);
    const byDay = new Map();
    for (const e of shown) {
      const k = !state.past && e.start.slice(0, 10) < todayStr ? todayStr : e.start.slice(0, 10); // probíhající vícedenní akce
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
    let html = '';
    for (const [day, evs] of byDay) {
      const hl = holidays.get(day);
      html += `<h3 class="dayh" id="d-${day}">${day === todayStr ? '<span class="today">DNES</span>' : ''}<span>${esc(dayLabel(day))}</span>${hl ? `<span class="holiday">${esc(hl)}</span>` : ''}</h3>${evs.map(eventHtml).join('')}`;
    }
    if (state.past && shownList.length > shown.length) html += `<p class="more"><button type="button" class="btn ghost" id="more">Zobrazit další akce (${shownList.length - shown.length})</button></p>`;
    // další měsíc = měsíc nejbližší dosud nezobrazené akce (prázdné měsíce se přeskočí)
    if (nextEv) { const [y, m] = nextEv.start.slice(0, 7).split('-').map(Number); html += `<p class="more"><button type="button" class="btn ghost" id="more" data-months="${monthsUntil(nextEv.start.slice(0, 10))}">Zobrazit další akce – ${MONTHS[m - 1]} ${y}</button></p>`; }
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
    let cells = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((w, i) => `<div class="wd${i > 4 ? ' we' : ''}">${w}</div>`).join('');
    const d = new Date(start);
    for (let i = 0; i < 42; i++, d.setDate(d.getDate() + 1)) {
      if (i === 35 && d.getMonth() !== m.getMonth()) break;
      const k = ymd(d), hl = holidays.get(k);
      // nejdřív jednorázové akce, pravidelné až za nimi
      const evs = (byDay.get(k) || []).slice().sort((a, b) => a.recurring - b.recurring || a.start.localeCompare(b.start));
      const pills = evs.slice(0, MAX_PILLS).map((e) => `<span class="pill${e.recurring ? ' rec' : ''}" style="--c:${eventColor(e)}" title="${esc(e.title)}">${e.allDay ? '' : timeOf(e.start) + ' '}${esc(e.title)}</span>`).join('');
      const more = evs.length > MAX_PILLS ? `<span class="pill more">+ ${evs.length - MAX_PILLS} další</span>` : '';
      const cls = ['cell', d.getMonth() !== m.getMonth() && 'other', k === todayStr && 'is-today', hl && 'hol', (d.getDay() === 0 || d.getDay() === 6) && 'we'].filter(Boolean).join(' ');
      cells += `<div class="${cls}" data-day="${k}" role="button" tabindex="0" aria-label="${esc(dayLabel(k))}: ${evs.length} akcí">
        <div class="top"><span class="n">${d.getDate()}</span>${hl ? `<span class="hl">${esc(hl)}</span>` : ''}</div>${pills}${more}</div>`;
    }
    return `<div class="mhead"><h2>${MONTHS[m.getMonth()]} ${m.getFullYear()}</h2>
      <div class="mnav"><button type="button" id="prev" aria-label="Předchozí měsíc">‹</button><button type="button" id="todayBtn">Dnes</button><button type="button" id="next" aria-label="Další měsíc">›</button></div></div>
      <div class="card grid">${cells}</div>`;
  }

  function goToDay(k) {
    const past = k < todayStr;
    if (past !== state.past) { state.past = past; state.limit = 400; render(); }
    let el = document.getElementById('d-' + k);
    if (!el && !past && monthsUntil(k) > state.months) { state.months = monthsUntil(k); render(); el = document.getElementById('d-' + k); }
    if (!el && state.limit < 2000) { state.limit = 2000; render(); el = document.getElementById('d-' + k); }
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (window.parent !== window) window.parent.postMessage({ type: 'kalendar-vb-scroll', top: el.getBoundingClientRect().top + window.scrollY }, '*');
    }
  }

  function render() {
    const list = DATA.events.filter(matches);
    $('#month').innerHTML = renderMonth(list);
    $('#list').innerHTML = renderList(list);
    const upcoming = list.filter((e) => e.end.slice(0, 10) >= todayStr);
    const rec = upcoming.filter((e) => e.recurring).length;
    $('#count').textContent = `${upcoming.length - rec} nadcházejících akcí${rec ? ` a ${rec} termínů pravidelných` : ''}`;
    const pastN = list.filter((e) => e.end.slice(0, 10) < todayStr).length;
    $('#pastBtn').textContent = state.past ? '← Zpět na nadcházející akce' : `Již proběhlé (${pastN})`;
    $('#reset').hidden = !(state.q || state.cats.size || state.srcs.size || !state.recurring);
    $('#more')?.addEventListener('click', (ev) => { if (state.past) state.limit += 80; else state.months = Math.max(state.months + 1, +ev.currentTarget.dataset.months || 0); render(); });
    $('#prev').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); });
    $('#next').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); });
    $('#todayBtn').addEventListener('click', () => { state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); });
    document.querySelectorAll('.cell').forEach((c) => {
      const go = () => goToDay(c.dataset.day);
      c.addEventListener('click', go);
      c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    });
    postHeight();
  }

  function chips(el, items, set) {
    const all = `<button type="button" class="chip" aria-pressed="true" data-all="1">Vše</button>`;
    el.innerHTML = all + items.map((i) => `<button type="button" class="chip" aria-pressed="false" data-id="${esc(i.id)}" style="--c:${i.color}"><span class="dot"></span>${esc(i.label)}</button>`).join('');
    const sync = () => {
      el.querySelector('[data-all]').setAttribute('aria-pressed', String(!set.size));
      el.querySelectorAll('[data-id]').forEach((b) => b.setAttribute('aria-pressed', String(set.has(b.dataset.id))));
    };
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('.chip');
      if (!b) return;
      if (b.dataset.all) set.clear();
      else set.has(b.dataset.id) ? set.delete(b.dataset.id) : set.add(b.dataset.id);
      sync(); state.limit = 80; render();
    });
    el._sync = sync;
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
      $('#list').innerHTML = '<p>Akce se nepodařilo načíst. Zkuste to prosím později.</p>';
      return;
    }
    SRC = Object.fromEntries(DATA.sources.map((s) => [s.id, s]));
    CAT = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));
    ORG = Object.fromEntries((DATA.organizers || []).map((o) => [o.id, o]));
    holidays = new Map(DATA.events.filter((e) => SRC[e.source]?.display === 'dayLabel').map((e) => [e.start.slice(0, 10), e.title]));
    const used = new Set(DATA.events.flatMap((e) => e.categories));
    chips($('#cats'), DATA.categories.filter((c) => used.has(c.id)), state.cats);
    const usedOrg = new Set(DATA.events.flatMap((e) => e.organizers || []));
    chips($('#srcs'), (DATA.organizers || []).filter((o) => usedOrg.has(o.id)).map((o) => ({ id: o.id, label: o.name, color: o.color })), state.srcs);
    state.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // na mobilu filtry sbalené
    if (window.matchMedia('(max-width: 700px)').matches) $('#ftoggle').setAttribute('aria-expanded', 'false');
    $('#ftoggle').addEventListener('click', () => {
      const b = $('#ftoggle'); b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true')); postHeight();
    });

    let t;
    $('#q').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { state.q = ev.target.value.trim(); state.limit = 80; render(); }, 150); });
    $('#showRecurring').addEventListener('change', (ev) => { state.recurring = ev.target.checked; render(); });
    $('#pastBtn').addEventListener('click', () => { state.past = !state.past; state.limit = 80; render(); });
    $('#reset').addEventListener('click', () => {
      state.q = ''; $('#q').value = ''; state.cats.clear(); state.srcs.clear(); state.recurring = true; $('#showRecurring').checked = true;
      $('#cats')._sync(); $('#srcs')._sync();
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
