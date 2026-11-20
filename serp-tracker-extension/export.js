// Shared by the popup and the Amazon page: ownership/targeting rules and CSV export.
'use strict';

// Yours = an ASIN you listed, or any ASIN of your brand name.
function srtIsMine(asin, brand, settings) {
  const b = (settings.myBrand || '').trim().toLowerCase();
  return (settings.myAsins || []).includes(asin) || (!!b && (brand || '').trim().toLowerCase() === b);
}

// Your pasted competitor list counts as already targeted, and so does every other ASIN in
// the same variation family (siblings or same parent, read from product pages).
function srtFamilyTargeted(asin, settings, products) {
  const list = settings.competitors || [];
  if (list.includes(asin)) return true;
  const p = products[asin] || {};
  if ((p.variationAsins || []).some((a) => list.includes(a))) return true;
  return !!p.parentAsin && list.some((a) => (products[a] || {}).parentAsin === p.parentAsin
    || ((products[a] || {}).variationAsins || []).includes(asin));
}

// Flag organic results that are neither yours nor targeted. Sponsored results are never
// flagged. No list pasted = no flags.
function srtNotTargeted(r, brand, settings, products) {
  return (settings.competitors || []).length > 0 && r.type === 'organic'
    && !srtIsMine(r.asin, brand, settings) && !srtFamilyTargeted(r.asin, settings, products);
}

// Rank in the product's own browse node (last breadcrumb), not the top-level category.
function srtNodeRank(p) {
  const bsr = p.bsr || [];
  const node = (p.breadcrumb || [])[(p.breadcrumb || []).length - 1];
  return bsr.find((b) => node && b.category.toLowerCase() === node.toLowerCase()) || bsr[bsr.length - 1] || null;
}

const srtHighlights = (p) => (Array.isArray(p.highlights) ? p.highlights.join(' · ') : p.highlights || '');

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

const SRT_CSV_TOP = 40;

// Organic results ranked 1-40 overall across pages 1-3, minus ASINs already targeted
// directly or through their variation family. `data` holds { products, settings } from storage.
function srtBuildCsv(snapshots, data) {
  const offsetOf = srtOffsetFinder(snapshots);
  const cols = ['date', 'time', 'marketplace', 'keyword', 'page', 'position',
    'organic_rank_on_page', 'organic_rank_overall',
    'asin', 'parent_asin', 'brand', 'is_my_asin', 'action',
    'title', 'highlights', 'bullets', 'bsr_rank', 'bsr_category', 'browse_node', 'bsr_all',
    'price', 'rating', 'reviews', 'pdp_rating', 'pdp_review_count', 'reviews_summary', 'top_reviews',
    'bought_past_month', 'bought_past_month_text', 'badges', 'prime', 'total_results_text', 'details_read_at'];
  const lines = [cols.join(',')];
  for (const snap of snapshots) {
    const d = new Date(snap.ts);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = d.toTimeString().slice(0, 5);
    const off = offsetOf(snap);
    if (!off) continue; // an earlier page is missing, so overall ranks are unknown
    for (const r of snap.results) {
      const overall = off.org + r.rank;
      if (r.type !== 'organic' || overall > SRT_CSV_TOP || srtFamilyTargeted(r.asin, data.settings, data.products)) continue;
      const p = data.products[r.asin] || {};
      const bsr = p.bsr || [];
      const node = srtNodeRank(p);
      const brand = (p.brand || r.brand || '').trim();
      lines.push([date, time, snap.marketplace, snap.keyword, snap.page, r.position, r.rank, overall,
        r.asin, p.parentAsin || '', brand, srtIsMine(r.asin, brand, data.settings) ? 'yes' : 'no',
        srtNotTargeted(r, brand, data.settings, data.products) ? 'Not targeted: add as product target' : '',
        p.title || r.title, srtHighlights(p), (p.bullets || []).map((b) => `• ${b}`).join('\n'),
        node ? node.rank : '', node ? node.category : '', (p.breadcrumb || []).join(' › '),
        bsr.map((b) => `#${b.rank} in ${b.category}`).join(' | '),
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
