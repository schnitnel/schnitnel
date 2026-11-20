// Runs on Amazon product pages: purple border around the page when the product is yours,
// and around every product card of yours (carousels such as "Products related to this item").
(async () => {
  'use strict';

  const s = await chrome.storage.local.get(['settings', 'products']);
  const settings = { myAsins: [], myBrand: '', competitors: [], ...(s.settings || {}) };
  const products = s.products || {};
  if (!settings.myAsins.length && !settings.myBrand) return;

  // Yours = listed ASINs plus every ASIN a scan found under your brand name.
  const mine = new Set(settings.myAsins);
  for (const [asin, p] of Object.entries(products)) {
    if (srtIsMine(asin, p.brand, settings)) mine.add(asin);
  }

  const style = document.createElement('style');
  style.textContent = `
    .srt-mine-card{outline:3px solid #6f42c1 !important;outline-offset:-3px;border-radius:6px;box-shadow:inset 0 0 0 9999px rgba(111,66,193,.08) !important}
    .srt-mine-page{outline:5px solid #6f42c1 !important;outline-offset:-5px}
    #srt-pdp-badge{position:fixed;left:16px;bottom:16px;z-index:2147483646;background:#6f42c1;color:#fff;
      font:600 13px Arial,sans-serif;padding:6px 10px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25)}`;
  document.head.appendChild(style);

  // The product on this page.
  const pageAsin = (location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1]
    || document.querySelector('#ASIN, input[name="ASIN"]')?.value;
  const byline = (document.querySelector('#bylineInfo')?.textContent || '')
    .replace(/\s+/g, ' ').trim().replace(/^Visit the\s+/i, '').replace(/\s+Store$/i, '').replace(/^Brand:\s*/i, '');
  if (pageAsin && (mine.has(pageAsin) || srtIsMine(pageAsin, byline, settings))) {
    mine.add(pageAsin);
    (document.querySelector('#dp-container, #dp, #ppd') || document.body).classList.add('srt-mine-page');
    const badge = document.createElement('div');
    badge.id = 'srt-pdp-badge';
    badge.textContent = `YOUR ASIN · ${pageAsin}`;
    document.body.appendChild(badge);
  }

  // Product cards: anything carrying data-asin, or a link to /dp/ASIN inside a card.
  function markCards() {
    for (const el of document.querySelectorAll('[data-asin]')) {
      const asin = el.getAttribute('data-asin');
      if (asin && asin !== pageAsin && mine.has(asin)) el.classList.add('srt-mine-card');
    }
    for (const a of document.querySelectorAll('a[href*="/dp/"]')) {
      const asin = (a.getAttribute('href').match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
      if (!asin || asin === pageAsin || !mine.has(asin)) continue;
      const card = a.closest('li, .a-carousel-card, [data-asin], [data-adfeedbackdetails]');
      if (card) card.classList.add('srt-mine-card');
    }
  }
  // Carousels load as you scroll, so mark again whenever the page changes.
  let timer = null;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(markCards, 400); })
    .observe(document.body, { childList: true, subtree: true });
  markCards();
})();
