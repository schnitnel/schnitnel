SERP Rank Tracker for Amazon - Chrome extension

INSTALL
1. Unzip this folder somewhere you will keep it (Chrome loads it from there).
2. In Chrome open chrome://extensions
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and pick the unzipped serp-tracker-extension folder.
5. Pin it: puzzle-piece icon in the toolbar -> pin "SERP Rank Tracker".

USE
- Settings tab: paste your ASINs (one per line) and click Save settings.
- Search volume tab: import your Search Query Performance CSV (Seller Central ->
  Brands -> Brand Analytics -> Search Query Performance -> download). Pick the
  period the file covers (week/month).
- Search Amazon normally. Each result gets a label (Org #3 / Ad #1) and the page
  is saved automatically (at most every 15 min per keyword and page; change in Settings).
- On a search page, click the toolbar icon -> "Scan pages 1-3 + details". It reads
  pages 1-3 and each product page (brand, full title, bullets, description, BSR),
  one request every 2.5-5 s. About 5-10 minutes for a new keyword; product details
  are reused for 7 days. Keep the tab open. If Amazon shows a captcha it stops;
  solve it on any Amazon page and scan again.
- Click a keyword: brand share of page 1, brand ASIN counts on pages 1-3, top 30
  organic and top 30 sponsored, and your ASINs' rank through the day.
- Competitors tab: paste your top 30 competitor ASINs and the ASINs you already
  target in PPC. Untargeted competitors are flagged "Add as product target";
  "Copy untargeted ASINs" copies them for a product-targeting campaign.
- Export CSV: every save, with separate organic and sponsored ranks (on the page and
  overall across pages 1-3), brand, title, bullets, description, BSR and competitor status.

NOTES
- It only reads pages you open yourself; it does not browse Amazon on its own.
- Daily searches are estimates: weekly volume / 7 (monthly / 30).
- Data stays in your Chrome on that computer. Export CSV to keep or share it.
- Works on amazon.com, .ca, .co.uk and .com.mx search pages.
