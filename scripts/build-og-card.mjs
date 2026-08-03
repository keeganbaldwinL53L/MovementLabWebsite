// Compose the social card. AG-5 F1 created a real og:image (every page had been
// declaring one that 404'd); AG-6/LN-11 observed that it was a face with no
// name, no wordmark and no words — and a share card is the one surface that
// travels DETACHED from the site, so it has to say who this is.
//
// WHY A BROWSER AND NOT sharp's text: the card is typeset in Outfit, the real
// self-hosted brand face. Rendering text through sharp/librsvg depends on
// system font availability and silently substitutes; a headless browser loads
// the actual woff2 the site ships and I assert the computed family before
// screenshotting, so a silent fallback cannot pass unnoticed.
//
// The photograph is UNCHANGED (WHICH photo is arguably Manny's editorial call,
// not a build decision — LN-11). Only the naming is added.
//
// Run: node scripts/build-og-card.mjs   → src/assets/brand/og-card.jpg
import { chromium } from '/Users/keeganbaldwin/opsapp/node_modules/playwright/index.mjs';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const fileUrl = (p) => 'file://' + path.resolve(ROOT, p).split(path.sep).map(encodeURIComponent).join('/');

const HTML = `<!doctype html><meta charset="utf-8">
<style>
  @font-face{font-family:'Outfit';src:url('${fileUrl('public/fonts/outfit-variable.woff2')}') format('woff2-variations');font-weight:100 900;font-style:normal}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;display:flex;font-family:'Outfit',sans-serif;background:#fdfbf8;overflow:hidden}
  .photo{width:520px;height:630px;flex:none;object-fit:cover;object-position:50% 20%}
  .panel{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 64px;gap:20px}
  .mark{width:64px;height:64px}
  h1{font-size:62px;line-height:1.02;font-weight:500;color:#2A3529;letter-spacing:-0.02em}
  p{font-size:29px;line-height:1.32;color:#4c554a;font-weight:400}
  .rule{width:96px;height:6px;background:#FF4D00;border-radius:3px}
</style>
<img class="photo" src="${fileUrl('src/assets/site/head-shot-smile-cropped.jpg')}">
<div class="panel">
  <img class="mark" src="${fileUrl('src/assets/brand/mark.png')}" alt="">
  <h1>Keegans<br>Movement Lab</h1>
  <div class="rule"></div>
  <p>Movement-focused chiropractic<br>on the Northern Beaches</p>
</div>`;

const tmp = path.join(ROOT, '.og-card.tmp.html');
fs.writeFileSync(tmp, HTML);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('file://' + tmp, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

// Fallback detection: a silent substitution looks exactly like a success.
const family = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontFamily);
if (!/Outfit/.test(family)) throw new Error(`brand font did not load — got ${family}`);

const buf = await page.screenshot();
await sharp(buf).resize(1200, 630).jpeg({ quality: 88 }).toFile(path.join(ROOT, 'src/assets/brand/og-card.jpg'));
await browser.close();
fs.unlinkSync(tmp);
console.log('og-card.jpg written — 1200x630, typeset in', family);
