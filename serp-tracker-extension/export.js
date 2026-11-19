// CSV export, shared by the popup and the Amazon page (scan results download).
'use strict';

// Organic/sponsored results on earlier pages, from the same-day save closest in time.
// shortcut: assumes pages saved close together belong to one ranking; a scan saves them seconds apart.
function srtOffsetFinder(snapshots) {
  const groups = new Map();
  for (const s of snapshots) {
    const k = `${s.keyword}|${s.marketplace}|${s.page}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
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

function srtCsvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per result in `snapshots`; `data` holds { products, settings } from storage.
function srtBuildCsv(snapshots, data) {
  const set = (list) => new Set((list || []).map((a) => a.toUpperCase()));
  const s = { mine: set(data.settings.myAsins), comps: set(data.settings.competitors), targeted: set(data.settings.targeted) };
  const offsetOf = srtOffsetFinder(snapshots);
  const cols = ['date', 'time', 'marketplace', 'keyword', 'page', 'position',
    'organic_rank_on_page', 'sponsored_rank_on_page', 'organic_rank_overall', 'sponsored_rank_overall',
    'asin', 'brand', 'is_my_asin', 'is_competitor', 'competitor_targeted', 'action',
    'title', 'highlights', 'bullets', 'description', 'bsr_rank', 'bsr_category', 'bsr_all',
    'price', 'rating', 'reviews', 'pdp_rating', 'pdp_review_count', 'reviews_summary', 'top_reviews',
    'bought_past_month', 'bought_past_month_text', 'badges', 'prime', 'total_results_text', 'details_read_at'];
  const lines = [cols.join(',')];
  for (const snap of snapshots) {
    const d = new Date(snap.ts);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = d.toTimeString().slice(0, 5);
    const off = offsetOf(snap);
    for (const r of snap.results) {
      const p = data.products[r.asin] || {};
      const bsr = p.bsr || [];
      const isOrg = r.type === 'organic';
      const isComp = s.comps.has(r.asin);
      lines.push([date, time, snap.marketplace, snap.keyword, snap.page, r.position,
        isOrg ? r.rank : '', isOrg ? '' : r.rank,
        isOrg && off ? off.org + r.rank : '', !isOrg && off ? off.sp + r.rank : '',
        r.asin, (p.brand || r.brand || '').trim(), s.mine.has(r.asin) ? 'yes' : 'no', isComp ? 'yes' : 'no',
        isComp ? (s.targeted.has(r.asin) ? 'yes' : 'no') : '', isComp && !s.targeted.has(r.asin) ? 'Add as product target' : '',
        p.title || r.title, (p.highlights || []).join(' | '), (p.bullets || []).join(' | '), p.description || '',
        bsr[0] ? bsr[0].rank : '', bsr[0] ? bsr[0].category : '', bsr.map((b) => `#${b.rank} in ${b.category}`).join(' | '),
        r.price, r.rating, r.reviews, p.rating, p.reviewCount, p.reviewsSummary || '',
        (p.topReviews || []).map((x) => `${x.stars || ''}★ ${x.title}: ${x.body}`).join(' || '),
        r.boughtPastMonth, r.boughtText, (r.badges || []).join('; '), r.prime ? 'yes' : 'no',
        snap.totalResultsText, p.fetchedAt ? new Date(p.fetchedAt).toISOString().slice(0, 16).replace('T', ' ') : '',
      ].map(srtCsvCell).join(','));
    }
  }
  return lines.join('\r\n');
}

function srtDownloadCsv(text, filename) {
  // BOM so Excel opens accented titles correctly.
  const blob = new Blob(['﻿' + text], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
