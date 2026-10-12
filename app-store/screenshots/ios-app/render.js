// Renders index.html into App Store screenshots:
//   node app-store/screenshots/ios-app/render.js [iphone|ipad]
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = `file://${path.join(root, "index.html")}`;

const outputs = [
  { device: "iphone", width: 1320, height: 2868, prefix: "iphone-69" },
  { device: "iphone", width: 1284, height: 2778, prefix: "iphone-65" },
  { device: "iphone", width: 1206, height: 2622, prefix: "iphone-63" },
  { device: "ipad", width: 2064, height: 2752, prefix: "ipad-13" },
];
const names = { 1: "wanikani", 2: "bunpro", 3: "commands", 4: "settings" };
const only = process.argv[2];

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  for (const output of outputs.filter((o) => !only || o.device === only)) {
    const page = await browser.newPage({ viewport: { width: output.width, height: output.height }, deviceScaleFactor: 1 });
    for (const shot of [1, 2, 3, 4]) {
      // Skip shots whose Simulator capture hasn't been taken for this device.
      if (!fs.existsSync(path.join(root, "raw", `${output.device}-${names[shot]}.png`))) continue;
      await page.goto(`${htmlPath}?device=${output.device}&shot=${shot}`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: path.join(root, "out", `${output.prefix}-${shot}-${names[shot]}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
