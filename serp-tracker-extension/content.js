// Runs on Amazon search result pages. Reads results, labels each one with its rank,
// saves timestamped snapshots, and (on request) scans pages 1-3 and product pages.
(() => {
  'use strict';

  const DEFAULTS = { autoCapture: true, minIntervalMin: 15, myAsins: [], competitors: [], targeted: [] };
  const DETAIL_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const normKeyword = (s) => clean(s).toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const politeDelay = () => sleep(2500 + Math.random() * 2500);
  const upperSet = (list) => new Set((list || []).map((a) => a.toUpperCase()));

  function toNumber(raw) {
    if (!raw) return null;
    const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'k') n *= 1e3;
    if (unit === 'm') n *= 1e6;
    return Math.round(n);
  }

  function toPrice(raw) {
    let s = clean(raw).replace(/[^0-9.,]/g, '');
    if (!s) return null;
    if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  function leafTexts(node, selector) {
    return [...node.querySelectorAll(selector)]
      .filter((e) => e.childElementCount === 0)
      .map((e) => clean(e.textContent));
  }

  // ---------- search result parsing ----------
  function isSponsored(node) {
    if (/AdHolder/.test(node.className || '')) return true;
    if (node.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text')) return true;
    return leafTexts(node, 'span, a').some((t) => t === 'Sponsored');
  }

  function parseRating(node) {
    for (const el of node.querySelectorAll('[aria-label*="out of 5 stars"], .a-icon-alt')) {
      const t = el.getAttribute('aria-label') || el.textContent;
      const m = (t || '').match(/(\d(?:[.,]\d)?) out of 5/);
      if (m) return parseFloat(m[1].replace(',', '.'));
    }
    return null;
  }

  function parseReviews(node) {
    const candidates = [
      ...node.querySelectorAll('[aria-label$="ratings"], [aria-label$="rating"]'),
      ...node.querySelectorAll('a[href*="customerReviews"] span'),
    ];
    for (const el of candidates) {
      const t = el.getAttribute('aria-label') || el.textContent || '';
      if (/out of 5/.test(t)) continue;
      const n = toNumber(t);
      if (n !== null) return n;
    }
    return null;
  }

  function parseBought(node) {
    const t = leafTexts(node, 'span').find((s) => /bought in past month/i.test(s) && s.length < 60);
    if (!t) return { boughtText: '', boughtPastMonth: null };
    const raw = t.replace(/bought in past month/i, '').trim();
    return { boughtText: raw, boughtPastMonth: toNumber(raw) };
  }

  function parseBadges(node) {
    const found = new Set();
    for (const t of leafTexts(node, '.a-badge-text, .a-badge-label-inner span, .s-label-popover-default span')) {
      if (t && t.length < 40) found.add(t);
    }
    const all = clean(node.textContent);
    if (/Amazon'?s\s*Choice/i.test(all)) found.add("Amazon's Choice");
    if (/Best Seller/i.test(all)) found.add('Best Seller');
    if (/Overall Pick/i.test(all)) found.add('Overall Pick');
    return [...found];
  }

  // Some categories show the brand as a small heading above the title; most do not.
  function parseTitleAndBrand(node) {
    const h2s = [...node.querySelectorAll('h2')];
    const titleH2 = h2s.find((h) => h.closest('a') || h.querySelector('a') || h.getAttribute('aria-label')) || h2s[h2s.length - 1];
    const title = clean(titleH2 && (titleH2.getAttribute('aria-label') || titleH2.textContent)).replace(/^Sponsored Ad - /i, '');
    const brandH2 = h2s.find((h) => h !== titleH2 && !h.querySelector('a'));
    return { title, brand: brandH2 ? clean(brandH2.textContent) : '' };
  }

  function parseResult(node) {
    const priceEl = node.querySelector('.a-price:not(.a-text-price) .a-offscreen');
    return {
      asin: node.getAttribute('data-asin').toUpperCase(),
      ...parseTitleAndBrand(node),
      price: priceEl ? toPrice(priceEl.textContent) : null,
      rating: parseRating(node),
      reviews: parseReviews(node),
      ...parseBought(node),
      badges: parseBadges(node),
      prime: !!node.querySelector('.a-icon-prime, [aria-label="Amazon Prime"]'),
    };
  }

  function parseSerp(doc, href) {
    const url = new URL(href);
    const keyword = normKeyword(url.searchParams.get('k') || url.searchParams.get('field-keywords') || '');
    const page = parseInt(url.searchParams.get('page') || '1', 10) || 1;
    const nodes = [...doc.querySelectorAll('div[data-component-type="s-search-result"][data-asin]')]
      .filter((n) => n.getAttribute('data-asin'));
    let organic = 0;
    let sponsored = 0;
    const results = nodes.map((node, i) => {
      const type = isSponsored(node) ? 'sponsored' : 'organic';
      const rank = type === 'organic' ? ++organic : ++sponsored;
      return { node, data: { position: i + 1, type, rank, ...parseResult(node) } };
    });
    const countEl = doc.querySelector('[data-component-type="s-result-info-bar"] h1 span, .s-desktop-toolbar h1 span');
    return {
      keyword,
      page,
      marketplace: url.hostname.replace(/^www\./, ''),
      totalResultsText: countEl ? clean(countEl.textContent) : '',
      results,
    };
  }

  // ---------- product page parsing ----------
  function parseProductPage(doc) {
    const byline = clean(doc.querySelector('#bylineInfo')?.textContent);
    const brand = byline.replace(/^Visit the\s+/i, '').replace(/\s+Store$/i, '').replace(/^Brand:\s*/i, '');
    const bullets = leafTexts(doc, '#feature-bullets li span.a-list-item, #productFactsDesktopExpander li span.a-list-item')
      .filter((t) => t && !/^Make sure this fits/i.test(t));
    let description = clean(doc.querySelector('#productDescription')?.textContent);
    // shortcut: brands with A+ content often have no plain description, so fall back to A+ text (first 3000 chars).
    if (!description) description = clean(doc.querySelector('#aplus_feature_div, #aplus')?.textContent).slice(0, 3000);
    let bsrText = '';
    for (const el of doc.querySelectorAll('#detailBulletsWrapper_feature_div li, #prodDetails tr, #productDetails_detailBullets_sections1 tr, #detailBullets_feature_div li')) {
      if (/Best Sellers Rank/i.test(el.textContent)) { bsrText = clean(el.textContent); break; }
    }
    const bsr = [...bsrText.matchAll(/#\s?([\d,]+)\s+in\s+([^#(]+?)(?=\s*\(|\s*#|$)/g)]
      .map((m) => ({ rank: parseInt(m[1].replace(/,/g, ''), 10), category: clean(m[2]) }));
    return {
      title: clean(doc.querySelector('#productTitle')?.textContent),
      brand: clean(brand),
      bullets: [...new Set(bullets)],
      description,
      bsr,
      fetchedAt: Date.now(),
    };
  }

  const isBlocked = (html) => /validateCaptcha|Type the characters you see|api-services-support@amazon\.com/i.test(html);

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();
    if (isBlocked(html)) throw new Error('Amazon asked for a captcha. Open any Amazon page, solve it, then try again.');
    if (!res.ok) throw new Error(`Amazon answered ${res.status} for ${url}`);
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // ---------- on-page labels ----------
  function injectStyles() {
    if (document.getElementById('srt-styles')) return;
    const style = document.createElement('style');
    style.id = 'srt-styles';
    style.textContent = `
      .srt-label{position:absolute;top:6px;left:6px;z-index:50;font:600 12px/1.2 Arial,sans-serif;
        padding:3px 7px;border-radius:4px;color:#fff;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.3)}
      .srt-organic{background:#1a7f37}.srt-sponsored{background:#b35900}
      .srt-mine{outline:3px solid #6f42c1 !important;outline-offset:-3px}
      .srt-mine .srt-label{background:#6f42c1}
      .srt-comp{outline:3px dashed #cf222e !important;outline-offset:-3px}
      #srt-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#fff;color:#111;
        font:13px/1.4 Arial,sans-serif;border:1px solid #ccc;border-radius:8px;padding:10px 12px;
        box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:320px}
      #srt-panel b{font-weight:700}#srt-panel .srt-muted{color:#666;font-size:12px}
      #srt-panel .srt-x{float:right;cursor:pointer;color:#888;margin-left:8px}`;
    document.head.appendChild(style);
  }

  function labelResults(results, settings) {
    const mine = upperSet(settings.myAsins);
    const comps = upperSet(settings.competitors);
    const targeted = upperSet(settings.targeted);
    for (const { node, data } of results) {
      node.querySelectorAll(':scope .srt-label').forEach((e) => e.remove());
      node.classList.toggle('srt-mine', mine.has(data.asin));
      node.classList.toggle('srt-comp', comps.has(data.asin));
      const label = document.createElement('div');
      label.className = `srt-label srt-${data.type}`;
      let text = `${data.type === 'organic' ? 'Org' : 'Ad'} #${data.rank} · pos ${data.position}`;
      if (comps.has(data.asin)) text += targeted.has(data.asin) ? ' · competitor, targeted' : ' · competitor, NOT targeted';
      label.textContent = text;
      if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
      node.appendChild(label);
    }
  }

  function setPanel(lines) {
    let panel = document.getElementById('srt-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'srt-panel';
      document.body.appendChild(panel);
    }
    panel.textContent = '';
    const close = document.createElement('span');
    close.className = 'srt-x';
    close.textContent = '✕';
    close.onclick = () => panel.remove();
    panel.appendChild(close);
    const title = document.createElement('b');
    title.textContent = 'SERP Rank Tracker';
    panel.appendChild(title);
    for (const [text, muted] of lines) {
      const div = document.createElement('div');
      div.textContent = text;
      if (muted) div.className = 'srt-muted';
      panel.appendChild(div);
    }
  }

  // ---------- saving ----------
  async function getAll() {
    const s = await chrome.storage.local.get(['settings', 'snapshots', 'volumes', 'products']);
    return {
      settings: { ...DEFAULTS, ...(s.settings || {}) },
      snapshots: s.snapshots || [],
      volumes: s.volumes || {},
      products: s.products || {},
    };
  }

  function snapshotOf(serp) {
    return {
      ts: Date.now(),
      keyword: serp.keyword,
      page: serp.page,
      marketplace: serp.marketplace,
      totalResultsText: serp.totalResultsText,
      results: serp.results.map((r) => r.data),
    };
  }

  async function capture(manual) {
    const { settings, snapshots, volumes } = await getAll();
    const serp = parseSerp(document, location.href);
    if (!serp.keyword || serp.results.length === 0) return { ok: false, reason: 'No search results found on this page.' };

    injectStyles();
    labelResults(serp.results, settings);
    const mine = upperSet(settings.myAsins);
    const myBest = serp.results.find((r) => r.data.type === 'organic' && mine.has(r.data.asin));
    const vol = volumes[serp.keyword];

    const last = [...snapshots].reverse().find((s) =>
      s.keyword === serp.keyword && s.page === serp.page && s.marketplace === serp.marketplace);
    const minutesSince = last ? (Date.now() - last.ts) / 60000 : Infinity;
    let status;
    if (!manual && !settings.autoCapture) {
      status = 'Auto-save is off. Use the toolbar button to save.';
    } else if (!manual && minutesSince < settings.minIntervalMin) {
      status = `Already saved ${Math.floor(minutesSince)} min ago (saves at most every ${settings.minIntervalMin} min).`;
    } else {
      snapshots.push(snapshotOf(serp));
      await chrome.storage.local.set({ snapshots });
      status = `Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    const organic = serp.results.filter((r) => r.data.type === 'organic').length;
    setPanel([
      [`Keyword: ${serp.keyword} · page ${serp.page}`],
      [`${organic} organic · ${serp.results.length - organic} sponsored`],
      [vol && vol.daily !== null ? `Est. daily searches: ${Math.round(vol.daily).toLocaleString()} (${vol.volume.toLocaleString()} ${vol.period})` : 'No search volume imported for this keyword', !vol],
      ...(myBest ? [[`Your best organic rank: #${myBest.data.rank}`]] : []),
      [status, true],
    ]);
    try { chrome.runtime.sendMessage({ type: 'captured', myBestOrganic: myBest ? myBest.data.rank : null }); } catch (e) { /* no listener */ }
    return { ok: true, status, keyword: serp.keyword, count: serp.results.length };
  }

  // Fetches search pages 1..pages for this keyword, then the product page of every ASIN on them. One request every 2.5-5 s, stops on a captcha.
  async function scan(pages, withDetails) {
    const base = new URL(location.href);
    const keyword = normKeyword(base.searchParams.get('k') || '');
    if (!keyword) return { ok: false, reason: 'Open an Amazon search results page first.' };
    injectStyles();
    const saved = [];
    try {
      for (let p = 1; p <= pages; p++) {
        setPanel([[`Scanning "${keyword}" page ${p} of ${pages}…`]]);
        const url = new URL(base);
        url.searchParams.set('page', String(p));
        const serp = parseSerp(await fetchDoc(url.href), url.href);
        if (!serp.results.length) break;
        const { snapshots } = await getAll();
        snapshots.push(snapshotOf(serp));
        await chrome.storage.local.set({ snapshots });
        saved.push(serp);
        if (p < pages) await politeDelay();
      }
      let fetched = 0;
      if (withDetails && saved.length) {
        const { products } = await getAll();
        // Page order, so a stopped scan still has page 1 complete. Details are reused for 7 days.
        const wanted = [...new Set(saved.flatMap((s) => s.results.map((r) => r.data.asin)))]
          .filter((a) => !products[a] || Date.now() - products[a].fetchedAt > DETAIL_MAX_AGE_MS);
        for (const [i, asin] of wanted.entries()) {
          setPanel([[`Reading product details ${i + 1} of ${wanted.length} (${asin})…`], ['Keep this tab open.', true]]);
          await politeDelay();
          const doc = await fetchDoc(`${base.origin}/dp/${asin}`);
          const { products: latest } = await getAll();
          latest[asin] = parseProductPage(doc);
          await chrome.storage.local.set({ products: latest });
          fetched++;
        }
      }
      const msg = `Saved ${saved.length} page${saved.length === 1 ? '' : 's'} for "${keyword}"` +
        (withDetails ? `, read ${fetched} product page${fetched === 1 ? '' : 's'}.` : '.');
      setPanel([[msg], ['Open the extension to see brand share and top 30.', true]]);
      return { ok: true, message: msg };
    } catch (e) {
      setPanel([[`Stopped: ${e.message}`], [`${saved.length} page(s) were saved before it stopped.`, true]]);
      return { ok: false, reason: e.message };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === 'capture') {
      capture(true).then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e) }));
      return true;
    }
    if (msg.type === 'scan') {
      // Reply at once: the scan outlives the popup. Progress shows in the on-page box.
      scan(msg.pages || 3, !!msg.withDetails);
      sendResponse({ ok: true, started: true });
      return false;
    }
    return false;
  });

  // Results can load late, and Amazon sometimes changes the results without a full page load.
  let lastUrl = '';
  async function tick(attempt = 0) {
    if (location.pathname !== '/s') return;
    const hasResults = document.querySelector('div[data-component-type="s-search-result"][data-asin]');
    if (!hasResults && attempt < 10) { setTimeout(() => tick(attempt + 1), 800); return; }
    lastUrl = location.href;
    await capture(false);
  }
  tick();
  setInterval(() => {
    if (lastUrl && location.href !== lastUrl) { lastUrl = location.href; setTimeout(tick, 1200); }
  }, 1500);
})();
