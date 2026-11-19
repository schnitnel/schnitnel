'use strict';

const DEFAULTS = { autoCapture: true, minIntervalMin: 15, myAsins: [], competitors: [], targeted: [] };
const SERP_URL = /^https:\/\/www\.amazon\.(com|ca|co\.uk|com\.mx)\/s\?/;
const $ = (id) => document.getElementById(id);
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const normKeyword = (s) => clean(s).toLowerCase();
const fmtNum = (n) => (n === null || n === undefined ? '' : Math.round(n).toLocaleString());
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const isToday = (ts) => sameDay(ts, Date.now());
const asinList = (text) => [...new Set(text.toUpperCase().split(/[\s,;]+/).filter((a) => /^[A-Z0-9]{10}$/.test(a)))];
const upperSet = (list) => new Set((list || []).map((a) => a.toUpperCase()));

let state = { snapshots: [], volumes: {}, products: {}, settings: { ...DEFAULTS } };

async function load() {
  const s = await chrome.storage.local.get(['snapshots', 'volumes', 'products', 'settings']);
  state = {
    snapshots: s.snapshots || [],
    volumes: s.volumes || {},
    products: s.products || {},
    settings: { ...DEFAULTS, ...(s.settings || {}) },
  };
}

function flash(msg, isErr) {
  const el = $('flash');
  el.textContent = msg;
  el.className = isErr ? 'flash err' : 'flash';
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.hidden = true; }, 6000);
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function fillTable(table, headers, rows) {
  table.textContent = '';
  const head = el('tr');
  headers.forEach(([h, cls]) => head.appendChild(el('th', h, cls)));
  table.appendChild(el('thead')).appendChild(head);
  const body = table.appendChild(el('tbody'));
  for (const { cells, cls, title } of rows) {
    const tr = el('tr', null, cls);
    if (title) tr.title = title;
    cells.forEach((c, i) => tr.appendChild(el('td', c, headers[i][1])));
    body.appendChild(tr);
  }
}

// ---------- shared lookups ----------
const brandOf = (r) => clean((state.products[r.asin] || {}).brand || r.brand);
const titleOf = (r) => (state.products[r.asin] || {}).title || r.title;
const sets = () => ({ mine: upperSet(state.settings.myAsins), comps: upperSet(state.settings.competitors), targeted: upperSet(state.settings.targeted) });

function flagOf(asin, s) {
  if (s.mine.has(asin)) return { text: 'Yours', cls: 'mine' };
  if (s.comps.has(asin)) return s.targeted.has(asin)
    ? { text: 'Competitor · targeted', cls: 'comp' }
    : { text: 'Competitor · NOT targeted', cls: 'comp' };
  return { text: '', cls: '' };
}

// Latest save of pages 1-3 for a keyword, plus overall ranks across those pages.
function combined(keyword) {
  const snaps = state.snapshots.filter((s) => s.keyword === keyword);
  if (!snaps.length) return null;
  const latest = snaps.reduce((a, b) => (b.ts > a.ts ? b : a));
  const pages = [1, 2, 3].map((p) => snaps
    .filter((s) => s.page === p && s.marketplace === latest.marketplace)
    .reduce((a, b) => (!a || b.ts > a.ts ? b : a), null));
  // Overall ranks only make sense for an unbroken run of pages starting at page 1.
  const run = [];
  for (const p of pages) { if (!p) break; run.push(p); }
  const organic = run.flatMap((s) => s.results.filter((r) => r.type === 'organic').map((r) => ({ ...r, page: s.page })))
    .map((r, i) => ({ ...r, overall: i + 1 }));
  const sponsored = run.flatMap((s) => s.results.filter((r) => r.type === 'sponsored').map((r) => ({ ...r, page: s.page })))
    .map((r, i) => ({ ...r, overall: i + 1 }));
  return { latest, pages, organic, sponsored };
}

// Organic/sponsored results on earlier pages, from the same-day save closest in time.
// shortcut: assumes pages saved close together belong to one ranking; a scan saves them seconds apart.
function makeOffsetFinder() {
  const groups = new Map();
  for (const s of state.snapshots) {
    const k = `${s.keyword}|${s.marketplace}|${s.page}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return (snap) => {
    let org = 0;
    let sp = 0;
    for (let q = 1; q < snap.page; q++) {
      const cands = (groups.get(`${snap.keyword}|${snap.marketplace}|${q}`) || []).filter((s) => sameDay(s.ts, snap.ts));
      if (!cands.length) return null;
      const near = cands.reduce((a, b) => (Math.abs(b.ts - snap.ts) < Math.abs(a.ts - snap.ts) ? b : a));
      org += near.results.filter((r) => r.type === 'organic').length;
      sp += near.results.filter((r) => r.type === 'sponsored').length;
    }
    return { org, sp };
  };
}

function untargetedOn(c, s) {
  if (!c) return [];
  return [...new Set([...c.organic, ...c.sponsored].map((r) => r.asin))]
    .filter((a) => s.comps.has(a) && !s.targeted.has(a));
}

// ---------- keywords ----------
function renderKeywords() {
  const s = sets();
  const filter = normKeyword($('kwFilter').value);
  const byKw = new Map();
  for (const snap of state.snapshots) {
    const row = byKw.get(snap.keyword) || { keyword: snap.keyword, today: 0, last: snap };
    if (isToday(snap.ts)) row.today++;
    if (snap.ts > row.last.ts) row.last = snap;
    byKw.set(snap.keyword, row);
  }
  const body = $('kwBody');
  body.textContent = '';
  [...byKw.values()].sort((a, b) => b.last.ts - a.last.ts)
    .filter((r) => !filter || r.keyword.includes(filter))
    .forEach((r) => {
      const c = combined(r.keyword);
      const best = c.organic.find((x) => s.mine.has(x.asin));
      const vol = state.volumes[r.keyword];
      const untargeted = untargetedOn(c, s).length;
      const tr = el('tr');
      [[r.keyword], [fmtNum(vol && vol.daily), 'num'], [String(r.today), 'num'], [fmtDateTime(r.last.ts)],
        [best ? `#${best.overall}` : '', 'num'], [untargeted ? `⚠ ${untargeted}` : '', untargeted ? 'num warn' : 'num']]
        .forEach(([v, cls]) => tr.appendChild(el('td', v, cls)));
      tr.onclick = () => showDetail(r.keyword);
      body.appendChild(tr);
    });
  $('kwEmpty').hidden = state.snapshots.length > 0;
}

function renderBrandShare(c) {
  const chart = $('brandChart');
  chart.textContent = '';
  const page1 = c.pages[0];
  if (!page1) {
    $('brandNote').textContent = 'Page 1 is not saved for this keyword yet.';
    return;
  }
  const counts = new Map();
  for (const r of page1.results) {
    const b = brandOf(r) || 'Unknown brand';
    const e = counts.get(b) || { organic: 0, sponsored: 0 };
    e[r.type]++;
    counts.set(b, e);
  }
  let rows = [...counts.entries()].map(([brand, v]) => ({ brand, ...v, total: v.organic + v.sponsored }))
    .sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand));
  if (rows.length > 10) {
    const rest = rows.slice(9);
    rows = [...rows.slice(0, 9), rest.reduce((a, r) => ({ brand: `Other (${rest.length} brands)`, organic: a.organic + r.organic, sponsored: a.sponsored + r.sponsored, total: a.total + r.total }), { organic: 0, sponsored: 0, total: 0 })];
  }
  const all = page1.results.length;
  const max = Math.max(...rows.map((r) => r.total));
  for (const r of rows) {
    const row = el('div', null, 'brow');
    const name = el('div', r.brand, 'bname');
    name.title = r.brand;
    const track = el('div', null, 'btrack');
    const bar = el('div', null, 'bar');
    for (const type of ['organic', 'sponsored']) {
      if (!r[type]) continue;
      const seg = el('div', null, `seg ${type}`);
      seg.style.width = `${(r[type] / max) * 300}px`;
      seg.title = `${r.brand}: ${r[type]} ${type} slot${r[type] === 1 ? '' : 's'} on page 1`;
      bar.appendChild(seg);
    }
    track.append(bar, el('span', `${Math.round((r.total / all) * 100)}% · ${r.organic} org · ${r.sponsored} ad`, 'bval'));
    row.append(name, track);
    chart.appendChild(row);
  }
  const unknown = page1.results.filter((r) => !brandOf(r)).length;
  $('brandNote').textContent = unknown
    ? `${unknown} of ${all} page-1 results have no brand yet. Click "Scan pages 1–3 + details" on this search to read their product pages.`
    : `${all} slots on page 1, saved ${fmtDateTime(page1.ts)}.`;
}

function renderEstate(c) {
  const per = new Map();
  c.pages.forEach((snap, i) => {
    if (!snap) return;
    for (const r of snap.results) {
      const b = brandOf(r) || 'Unknown brand';
      const e = per.get(b) || [new Set(), new Set(), new Set()];
      e[i].add(r.asin);
      per.set(b, e);
    }
  });
  const rows = [...per.entries()].map(([b, e]) => ({ b, n: e.map((x) => x.size), total: new Set(e.flatMap((x) => [...x])).size }))
    .sort((a, b) => b.n[0] - a.n[0] || b.total - a.total);
  const missing = (i) => (c.pages[i] ? '' : ' (not saved)');
  fillTable($('estateTable'), [['Brand'], [`Page 1${missing(0)}`, 'num'], [`Page 2${missing(1)}`, 'num'], [`Page 3${missing(2)}`, 'num'], ['Unique ASINs', 'num']],
    rows.map((r) => ({ cells: [r.b, ...r.n.map(String), String(r.total)] })));
}

function renderTop30(table, list, s) {
  fillTable(table, [['#', 'num'], ['Page', 'num'], ['ASIN'], ['Brand'], ['Flag']], list.slice(0, 30).map((r) => {
    const f = flagOf(r.asin, s);
    return { cells: [String(r.overall), String(r.page), r.asin, brandOf(r), f.text], cls: f.cls, title: titleOf(r) };
  }));
  if (!list.length) table.appendChild(el('caption', 'No results saved.', 'muted'));
}

function renderHistory(keyword, s) {
  const today = state.snapshots.filter((x) => x.keyword === keyword && isToday(x.ts)).sort((a, b) => a.ts - b.ts);
  const offsetOf = makeOffsetFinder();
  const seen = [...new Set(today.flatMap((x) => x.results.filter((r) => s.mine.has(r.asin)).map((r) => r.asin)))];
  const wrap = $('historyWrap');
  wrap.textContent = '';
  if (!s.mine.size) { wrap.appendChild(el('p', 'Add your ASINs in Settings to see how their rank moves during the day.', 'muted')); return; }
  if (!seen.length) { wrap.appendChild(el('p', "None of your ASINs showed up in today's saves for this keyword.", 'muted')); return; }
  const t = el('table', null, 'hist');
  fillTable(t, [['Time'], ['Page', 'num'], ...seen.map((a) => [a])], today.map((x) => {
    const off = offsetOf(x);
    return {
      cells: [fmtTime(x.ts), String(x.page), ...seen.map((asin) => {
        const org = x.results.find((r) => r.asin === asin && r.type === 'organic');
        const ad = x.results.find((r) => r.asin === asin && r.type === 'sponsored');
        const fmt = (r, label, n) => (r ? `${label} #${off ? n + r.rank : r.rank}${off ? '' : ` on p${x.page}`}` : '');
        return [fmt(org, 'Org', off && off.org), fmt(ad, 'Ad', off && off.sp)].filter(Boolean).join(' · ') || '—';
      })],
    };
  }));
  wrap.appendChild(t);
}

function showDetail(keyword) {
  const s = sets();
  const c = combined(keyword);
  const vol = state.volumes[keyword];
  $('kwList').hidden = true;
  $('kwDetail').hidden = false;
  $('detailTitle').textContent = keyword;
  $('detailMeta').textContent = [
    `Last saved ${fmtDateTime(c.latest.ts)} · ${c.latest.marketplace}`,
    `pages saved: ${c.pages.map((p, i) => (p ? i + 1 : null)).filter(Boolean).join(', ') || 'none of 1–3'}`,
    c.latest.totalResultsText,
    vol && vol.daily !== null ? `Est. ${fmtNum(vol.daily)} searches/day (${fmtNum(vol.volume)} ${vol.period})` : 'No search volume imported',
    vol && vol.sfr ? `Search Frequency Rank ${fmtNum(vol.sfr)}` : '',
  ].filter(Boolean).join(' · ');
  const untargeted = untargetedOn(c, s);
  const box = $('actionBox');
  box.textContent = '';
  if (untargeted.length) {
    const a = el('div', null, 'action');
    a.append(el('b', `Action: ${untargeted.length} competitor${untargeted.length === 1 ? '' : 's'} rank here but are not in your product targeting: `), document.createTextNode(untargeted.join(', ')));
    box.appendChild(a);
  }
  renderBrandShare(c);
  renderEstate(c);
  renderTop30($('topOrganic'), c.organic, s);
  renderTop30($('topSponsored'), c.sponsored, s);
  renderHistory(keyword, s);
}

// ---------- competitors ----------
function competitorRows() {
  const s = sets();
  const best = new Map();
  const keywords = [...new Set(state.snapshots.map((x) => x.keyword))];
  for (const kw of keywords) {
    const c = combined(kw);
    for (const [list, key] of [[c.organic, 'org'], [c.sponsored, 'ad']]) {
      for (const r of list) {
        if (!s.comps.has(r.asin)) continue;
        const b = best.get(r.asin) || {};
        if (!b[key] || r.overall < b[key].rank) b[key] = { rank: r.overall, kw };
        b.result = b.result || r;
        best.set(r.asin, b);
      }
    }
  }
  return state.settings.competitors.map((asin) => {
    const b = best.get(asin) || {};
    const p = state.products[asin] || {};
    const isTargeted = s.targeted.has(asin);
    return {
      asin,
      brand: p.brand || (b.result && b.result.brand) || '',
      title: p.title || (b.result && b.result.title) || '',
      org: b.org,
      ad: b.ad,
      isTargeted,
      action: isTargeted ? '' : 'Add as product target',
    };
  });
}

function renderCompetitors() {
  $('competitors').value = state.settings.competitors.join('\n');
  $('targeted').value = state.settings.targeted.join('\n');
  const fmt = (x) => (x ? `#${x.rank} · ${x.kw}` : 'not seen');
  fillTable($('compTable'), [['ASIN'], ['Brand'], ['Best organic'], ['Best sponsored'], ['Targeted?'], ['Action']],
    competitorRows().map((r) => ({
      cells: [r.asin, r.brand, fmt(r.org), fmt(r.ad), r.isTargeted ? '✓ yes' : '⚠ no', r.action],
      cls: r.isTargeted ? '' : 'comp',
      title: r.title,
    })));
}

// ---------- CSV ----------
function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const KW_COL = /^(search query|search term|search terms|keyword|keyword phrase|keywords|customer search term)$/i;
const VOL_COL = /^(search query volume|search volume|exact search volume|volume|monthly search volume)$/i;
const SFR_COL = /search frequency rank/i;
const intOf = (s) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d ? parseInt(d, 10) : null; };

function importVolumes(text, period) {
  const rows = parseDelimited(text);
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => KW_COL.test(clean(c))));
  if (headerIdx < 0) throw new Error('Could not find a keyword column ("Search Query", "Search Term" or "Keyword").');
  const header = rows[headerIdx].map(clean);
  const kwI = header.findIndex((c) => KW_COL.test(c));
  const volI = header.findIndex((c) => VOL_COL.test(c));
  const sfrI = header.findIndex((c) => SFR_COL.test(c));
  if (volI < 0 && sfrI < 0) throw new Error('Could not find a "Search Query Volume", "Search Volume" or "Search Frequency Rank" column.');
  const divisor = period === 'weekly' ? 7 : period === 'monthly' ? 30 : 1;
  const acc = new Map();
  for (const r of rows.slice(headerIdx + 1)) {
    const kw = normKeyword(r[kwI]);
    if (!kw) continue;
    const a = acc.get(kw) || { vols: [], sfrs: [] };
    const v = volI >= 0 ? intOf(r[volI]) : null;
    const f = sfrI >= 0 ? intOf(r[sfrI]) : null;
    if (v !== null) a.vols.push(v);
    if (f !== null) a.sfrs.push(f);
    acc.set(kw, a);
  }
  const avg = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  let added = 0;
  for (const [kw, a] of acc) {
    const volume = avg(a.vols);
    const sfr = avg(a.sfrs);
    if (volume === null && sfr === null) continue;
    state.volumes[kw] = {
      volume: volume === null ? null : Math.round(volume),
      period,
      daily: volume === null ? null : volume / divisor,
      sfr: sfr === null ? null : Math.round(sfr),
      importedAt: Date.now(),
    };
    added++;
  }
  return added;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const s = sets();
  const offsetOf = makeOffsetFinder();
  const cols = ['date', 'time', 'marketplace', 'keyword', 'page', 'position',
    'organic_rank_on_page', 'sponsored_rank_on_page', 'organic_rank_overall', 'sponsored_rank_overall',
    'asin', 'brand', 'is_my_asin', 'is_competitor', 'competitor_targeted', 'action',
    'title', 'bullets', 'description', 'bsr_rank', 'bsr_category', 'bsr_all',
    'price', 'rating', 'reviews', 'bought_past_month', 'bought_past_month_text', 'badges', 'prime',
    'search_volume', 'volume_period', 'est_daily_searches', 'search_frequency_rank', 'total_results_text', 'details_read_at'];
  const lines = [cols.join(',')];
  for (const snap of state.snapshots) {
    const d = new Date(snap.ts);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = d.toTimeString().slice(0, 5);
    const vol = state.volumes[snap.keyword] || {};
    const off = offsetOf(snap);
    for (const r of snap.results) {
      const p = state.products[r.asin] || {};
      const bsr = p.bsr || [];
      const isOrg = r.type === 'organic';
      const isComp = s.comps.has(r.asin);
      lines.push([date, time, snap.marketplace, snap.keyword, snap.page, r.position,
        isOrg ? r.rank : '', isOrg ? '' : r.rank,
        isOrg && off ? off.org + r.rank : '', !isOrg && off ? off.sp + r.rank : '',
        r.asin, brandOf(r), s.mine.has(r.asin) ? 'yes' : 'no', isComp ? 'yes' : 'no',
        isComp ? (s.targeted.has(r.asin) ? 'yes' : 'no') : '', isComp && !s.targeted.has(r.asin) ? 'Add as product target' : '',
        titleOf(r), (p.bullets || []).join(' | '), p.description || '',
        bsr[0] ? bsr[0].rank : '', bsr[0] ? bsr[0].category : '', bsr.map((b) => `#${b.rank} in ${b.category}`).join(' | '),
        r.price, r.rating, r.reviews, r.boughtPastMonth, r.boughtText, (r.badges || []).join('; '), r.prime ? 'yes' : 'no',
        vol.volume, vol.period, vol.daily === null || vol.daily === undefined ? '' : Math.round(vol.daily), vol.sfr,
        snap.totalResultsText, p.fetchedAt ? new Date(p.fetchedAt).toISOString().slice(0, 16).replace('T', ' ') : '',
      ].map(csvCell).join(','));
    }
  }
  // BOM so Excel opens accented titles correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `amazon-serp-ranks-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- settings ----------
function renderSettings() {
  $('myAsins').value = state.settings.myAsins.join('\n');
  $('autoCapture').checked = state.settings.autoCapture;
  $('minInterval').value = state.settings.minIntervalMin;
  const n = state.snapshots.length;
  $('storageInfo').textContent = `${n.toLocaleString()} saved snapshot${n === 1 ? '' : 's'}, ${Object.keys(state.products).length.toLocaleString()} product pages read.`;
  $('volCount').textContent = `${Object.keys(state.volumes).length.toLocaleString()} keywords have search volume.`;
}

function renderAll() { renderKeywords(); renderCompetitors(); renderSettings(); }

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set({ settings: state.settings });
  renderAll();
}

// ---------- wiring ----------
document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    for (const t of ['keywords', 'competitors', 'import', 'settings']) $(`tab-${t}`).hidden = t !== b.dataset.tab;
  };
});

$('kwFilter').oninput = renderKeywords;
$('backBtn').onclick = () => { $('kwDetail').hidden = true; $('kwList').hidden = false; };

async function sendToSerpTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !SERP_URL.test(tab.url || '')) {
    flash('Open an Amazon search results page first, then click this again.', true);
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    flash('Reload the Amazon page once (the extension was just installed or updated), then try again.', true);
    return null;
  }
}

$('captureBtn').onclick = async () => {
  const res = await sendToSerpTab({ type: 'capture' });
  if (!res) return;
  if (res.ok) {
    flash(`Saved ${res.count} results for "${res.keyword}".`);
    await load();
    renderAll();
  } else flash(res.reason || 'Could not read this page.', true);
};

$('scanBtn').onclick = async () => {
  const res = await sendToSerpTab({ type: 'scan', pages: 3, withDetails: true });
  if (res && res.started) flash('Scan started. Watch the box on the Amazon page; it takes a few minutes. Reopen this window when it says done.');
};

$('exportBtn').onclick = () => {
  if (!state.snapshots.length) { flash('Nothing to export yet.', true); return; }
  exportCsv();
};

$('saveComps').onclick = async () => {
  const competitors = asinList($('competitors').value);
  if (competitors.length > 30) flash(`You pasted ${competitors.length} competitor ASINs; all are kept, but the list is meant for your top 30.`);
  await saveSettings({ competitors, targeted: asinList($('targeted').value) });
  if (competitors.length <= 30) flash(`Saved ${competitors.length} competitors and ${state.settings.targeted.length} targeted ASINs.`);
};

$('copyUntargeted').onclick = async () => {
  const list = competitorRows().filter((r) => !r.isTargeted).map((r) => r.asin);
  if (!list.length) { flash('Every competitor is already targeted.'); return; }
  await navigator.clipboard.writeText(list.join('\n'));
  flash(`Copied ${list.length} untargeted ASINs. Paste them into a product-targeting campaign.`);
};

$('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const added = importVolumes(await file.text(), $('period').value);
    await chrome.storage.local.set({ volumes: state.volumes });
    $('importMsg').textContent = `Imported search volume for ${added.toLocaleString()} keywords from ${file.name}.`;
    renderAll();
  } catch (err) {
    $('importMsg').textContent = err.message;
  }
  e.target.value = '';
};

$('clearVolBtn').onclick = async () => {
  if (!confirm('Remove all imported search volumes?')) return;
  state.volumes = {};
  await chrome.storage.local.set({ volumes: {} });
  renderAll();
};

$('saveSettings').onclick = async () => {
  const minutes = Math.max(0, Math.min(1440, parseInt($('minInterval').value, 10) || 0));
  await saveSettings({ myAsins: asinList($('myAsins').value), autoCapture: $('autoCapture').checked, minIntervalMin: minutes });
  flash(`Settings saved. Tracking ${state.settings.myAsins.length} ASIN${state.settings.myAsins.length === 1 ? '' : 's'}.`);
};

$('clearDataBtn').onclick = async () => {
  if (!confirm('Delete every saved snapshot and product detail? Export a CSV first if you want to keep them.')) return;
  state.snapshots = [];
  state.products = {};
  await chrome.storage.local.set({ snapshots: [], products: {} });
  renderAll();
};

load().then(renderAll);
