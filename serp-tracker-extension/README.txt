SERP Rank Tracker for Amazon - Chrome extension

INSTALL
1. Unzip this folder somewhere you will keep it (Chrome loads it from there).
2. In Chrome open chrome://extensions
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and pick the unzipped serp-tracker-extension folder.
5. Pin it: puzzle-piece icon in the toolbar -> pin "SERP Rank Tracker".

USE
- Settings tab: enter your brand name as Amazon shows it (and any extra ASINs),
  then Save settings. Your ASINs are highlighted purple on Amazon search pages
  and product pages (the whole page when it is yours, and your product cards in
  carousels like "Products related to this item").
- Search Amazon normally. Each result gets a label (Org #3 / Ad #1). Nothing is
  saved until you scan.
- On a search page, click the toolbar icon -> "Scan pages 1-3 + details". It reads
  pages 1-3 and each product page (brand, title, the highlights line under the
  title, bullets, BSR and browse node, rating, review count, review summary and
  top 5 reviews),
  one request every 2.5-5 s. About 5-10 minutes for a new keyword; product details
  are reused for 7 days. Keep the tab open. When it finishes, click "Download CSV"
  in the box on the Amazon page for that scan's results. If Amazon shows a captcha
  it stops; solve it on any Amazon page and scan again.
- Click a keyword: brand share per page (switch Page 1/2/3): your brand and the
  top 10 competitor brands as bars, every other brand listed underneath with its
  % share and organic/sponsored count; brand ASIN counts on pages 1-3, top 30
  organic and top 30 sponsored, and your ASINs' rank through the day.
  Click any top-30 row to see that product's page details.
- Top 30: paste your top 30 competitor ASINs and click "Save and flag". They count
  as already targeted, and so does every ASIN in the same variation family (same
  parent ASIN or listed as a sibling on the product page). Every ORGANIC ASIN on
  pages 1-3 that is not targeted and not yours is flagged "Not targeted"
  (sponsored results are never flagged).
  "Copy untargeted ASINs" copies them for a product-targeting campaign.
- Competitors tab: where each pasted ASIN ranks across all your keywords.
- CSV (Download CSV after a scan, or Export CSV for all scans): only the top 40
  ORGANIC results across pages 1-3, leaving out ASINs already targeted directly or
  through their variation family. Columns: organic rank on the page and overall,
  parent ASIN, brand, title, highlights, bullets (one per line),
  bsr_rank in the product's browse node, browse_node path, bsr_all (every rank,
  including the top category), rating, review count, review summary, top reviews
  and a "Not targeted" action for untargeted ones. No product description.

NOTES
- It only reads pages you open yourself; it does not browse Amazon on its own.
- Data stays in your Chrome on that computer. Export CSV to keep or share it.
- Works on amazon.com, .ca, .co.uk and .com.mx search pages.
