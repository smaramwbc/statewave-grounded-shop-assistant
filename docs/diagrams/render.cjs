const path = require("path");
const puppeteer = require("puppeteer-core");

// Regenerating the diagram PNGs is a manual, occasional task, so puppeteer-core
// is deliberately not a project dependency. Install it ad hoc when you need to
// re-render:
//
//   npm i --no-save puppeteer-core
//
// It expects an existing Chrome/Chromium rather than downloading one, so point
// CHROME_PATH at your browser, e.g.
//   macOS   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
//   Linux   CHROME_PATH=/usr/bin/google-chrome
//   Windows CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const CHROME_PATH = process.env.CHROME_PATH;

if (!CHROME_PATH) {
  console.error(
    "CHROME_PATH is not set. Set it to a local Chrome/Chromium executable, e.g.\n" +
      '  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node docs/diagrams/render.cjs'
  );
  process.exit(1);
}

async function render(htmlFile, pngFile, width) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800, deviceScaleFactor: 2 });
  await page.goto("file://" + path.resolve(htmlFile), { waitUntil: "networkidle0" });
  await page.screenshot({ path: pngFile, fullPage: true });
  await browser.close();
  console.log("wrote", pngFile);
}

(async () => {
  await render(path.join(__dirname, "architecture.html"), path.join(__dirname, "..", "images", "architecture.png"), 1520);
  await render(path.join(__dirname, "chat-sequence.html"), path.join(__dirname, "..", "images", "chat-sequence.png"), 1180);
})();
