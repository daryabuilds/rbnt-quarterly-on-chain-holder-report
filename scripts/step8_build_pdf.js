/* Step 8. Print the report page to PDF and render the social card.

   Serves public/ on a local port, opens index.html?print=1 in Chromium
   (light theme, no animation, every table expanded) and saves:
     public/downloads/RBNT-Holder-Report-Q3-2026.pdf
     public/assets/img/og-image.png   (1200 x 630 social card)

   Usage: node scripts/step8_build_pdf.js
   Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".csv": "text/csv", ".md": "text/markdown", ".pdf": "application/pdf", ".xlsx": "application/octet-stream" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split("?")[0]);
      let f = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "report.json"), "utf8"));
  const browser = await chromium.launch();

  // PDF: lay the page out at the printable width of A4 (210mm - 24mm margins)
  const page = await browser.newPage({ viewport: { width: 703, height: 1000 } });
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  await page.goto(`${base}/index.html?print=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const label = report.meta.quarter.label;
  const out = path.join(ROOT, "downloads", `RBNT-Holder-Report-${label.replace(/\s+/g, "-")}.pdf`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
    headerTemplate: `<div style="font-family:'Be Vietnam Pro',sans-serif;font-size:7.5px;color:#596975;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>RBNT Quarterly On-Chain Holder Report, ${label}</span><span>Redbelly DAO Community Task Board</span></div>`,
    footerTemplate: `<div style="font-family:'Be Vietnam Pro',sans-serif;font-size:7.5px;color:#596975;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>Data verified ${report.meta.generated_utc}. Not financial advice.</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  console.log("wrote", out);

  // Social card
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.goto(`${base}/og.html`, { waitUntil: "networkidle" });
  await og.evaluate(() => document.fonts.ready);
  await og.waitForTimeout(300);
  await og.screenshot({ path: path.join(ROOT, "assets", "img", "og-image.png") });
  console.log("wrote og-image.png");

  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
