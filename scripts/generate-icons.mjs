// Regenerates the TabTrack mark and app icons in public/ from the glyph below.
//
//   node scripts/generate-icons.mjs
//
// Writes:
//   public/tabtrack-mark.svg   rounded tile, used as the favicon and the header logo
//   public/icon-192.png        full-bleed square (manifest, "any maskable")
//   public/icon-512.png        full-bleed square (manifest, "any maskable")
//   public/apple-touch-icon.png  full-bleed square; iOS rounds the corners itself
//
// The PNGs are rendered with the Playwright Chromium that the e2e suite already uses.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

// Keep in sync with brand-600 in tailwind.config.ts.
const BRAND = "#0e5e45";
const TINT = "#9fd8bd";

// "Split Coin": a coin cut in half, one half nudged away. Drawn on a 64-unit grid.
const glyph = [
  `<path fill="#ffffff" transform="translate(-2.5 1.5)" d="M32 12A20 20 0 0 0 32 52Z"/>`,
  `<path fill="${TINT}" transform="translate(2.5 -1.5)" d="M32 12A20 20 0 0 1 32 52Z"/>`,
].join("");

function svg({ rounded }) {
  const background = rounded
    ? `<rect width="64" height="64" rx="14" fill="${BRAND}"/>`
    : `<rect width="64" height="64" fill="${BRAND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${background}${glyph}</svg>\n`;
}

await writeFile(path.join(publicDir, "tabtrack-mark.svg"), svg({ rounded: true }));

// Set CHROMIUM_PATH to use a Chromium other than the one Playwright downloaded.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
try {
  const page = await browser.newPage();
  const fullBleed = svg({ rounded: false });

  for (const [file, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0">${fullBleed.replace(
        'width="64" height="64"',
        `width="${size}" height="${size}"`
      )}</body></html>`
    );
    await page.locator("svg").screenshot({ path: path.join(publicDir, file), omitBackground: true });
  }
} finally {
  await browser.close();
}

console.log("Wrote tabtrack-mark.svg, icon-192.png, icon-512.png, apple-touch-icon.png");
