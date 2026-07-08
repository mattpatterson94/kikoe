import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = `file://${path.join(root, "index.html")}`;

const outputs = [
  { device: "iphone", width: 1284, height: 2778, prefix: "iphone-67" },
  { device: "iphone", width: 1242, height: 2688, prefix: "iphone-65" },
  { device: "ipad", width: 2064, height: 2752 },
];

const names = {
  1: "wanikani",
  2: "bunpro",
  3: "settings",
  4: "safari-guide",
};

(async () => {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    for (const output of outputs) {
      const page = await browser.newPage({
        viewport: { width: output.width, height: output.height },
        deviceScaleFactor: 1,
      });

      for (const shot of [1, 2, 3, 4]) {
        await page.goto(`${htmlPath}?device=${output.device}&shot=${shot}`);
        await page.screenshot({
          path: path.join(root, `${output.prefix ?? output.device}-${shot}-${names[shot]}.png`),
          fullPage: false,
        });
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
})();
