import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = `file://${path.join(root, "macos.html")}`;
const names = {
  1: "wanikani",
  2: "bunpro",
  3: "settings",
  4: "setup",
};

(async () => {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    for (const shot of [1, 2, 3, 4]) {
      await page.goto(`${htmlPath}?shot=${shot}`);
      await page.screenshot({
        path: path.join(root, "macos", `macos-${shot}-${names[shot]}.png`),
        fullPage: false,
      });
    }
    await page.close();
  } finally {
    await browser.close();
  }
})();
