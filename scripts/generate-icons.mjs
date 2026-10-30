#!/usr/bin/env node
/**
 * scripts/generate-icons.mjs -- draws the favicon set from one SVG.
 *
 *   node scripts/generate-icons.mjs
 *
 * Renders with headless Chrome, so it needs no image library. The .ico holds
 * PNG frames, which every current browser reads. CHROME_PATH overrides the
 * browser location. Run again only if the mark changes; the output is committed.
 */

import fs from 'node:fs';

import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// lucide's crosshair on the accent colour, the same mark as components/shell/wordmark.tsx.
const svg = (size) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" style="display:block">
  <rect width="32" height="32" rx="7" fill="#F5A524"/>
  <g transform="translate(5 5) scale(0.9167)" fill="none" stroke="#0B0D12" stroke-width="2.4" stroke-linecap="round">
    <circle cx="12" cy="12" r="9.5"/>
    <line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/>
    <line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>
  </g>
</svg></body></html>`;

/** ICO container around PNG frames. */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + 16 * frames.length;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const render = async (size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(svg(size));
    const png = await page.screenshot({ omitBackground: true });
    await page.close();
    return png;
  };

  fs.mkdirSync('public', { recursive: true });
  const small = [16, 32, 48];
  const frames = [];
  for (const size of small) frames.push({ size, png: await render(size) });
  fs.writeFileSync('app/favicon.ico', ico(frames));
  fs.writeFileSync('app/icon.png', frames[1].png);
  fs.writeFileSync('app/apple-icon.png', await render(180));
  fs.writeFileSync('public/icon-192.png', await render(192));
  fs.writeFileSync('public/icon-512.png', await render(512));
  console.log('app/favicon.ico, app/icon.png, app/apple-icon.png, public/icon-192.png, public/icon-512.png');
} finally {
  await browser.close();
}
