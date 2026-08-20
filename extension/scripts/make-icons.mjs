/**
 * Renders the extension icons from the same idea the widget uses: a ring that
 * travels from the "needs work" pole to the "ready" pole. Generated rather
 * than hand-drawn so the icon and the in-page halo cannot drift apart, and so
 * a token change is one edit rather than five re-exports.
 *
 *   node scripts/make-icons.mjs
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OCHRE = '#C77B29';
const TEAL = '#0F9B8E';
const INK = '#16181A';
const SIZES = [16, 32, 48, 96, 128];
const OUT = resolve(import.meta.dirname, '../public/icon');

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage();
await mkdir(OUT, { recursive: true });

for (const size of SIZES) {
  const dataUrl = await page.evaluate(
    ({ size, ochre, teal, ink }) => {
      const scale = 4; // supersample, then let the PNG encoder downsample
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size * scale;
      const ctx = canvas.getContext('2d');

      const c = (size * scale) / 2;
      const stroke = Math.max(2, size * scale * 0.13);
      const radius = c - stroke / 2 - size * scale * 0.06;

      // Rounded dark tile, so the mark reads on both browser themes.
      const r = size * scale * 0.22;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.roundRect(0, 0, size * scale, size * scale, r);
      ctx.fill();

      // Idle track.
      ctx.strokeStyle = 'rgba(138,143,148,0.30)';
      ctx.lineWidth = stroke;
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      ctx.stroke();

      // The score arc, ~72% filled, warm pole into cool pole.
      const gradient = ctx.createLinearGradient(0, size * scale, size * scale, 0);
      gradient.addColorStop(0, ochre);
      gradient.addColorStop(1, teal);
      ctx.strokeStyle = gradient;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(c, c, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.72);
      ctx.stroke();

      // Downsample the supersampled tile to the requested size; exporting the
      // 4x canvas directly would emit a 512px file for a 128px icon slot.
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(canvas, 0, 0, size, size);
      return out.toDataURL('image/png');
    },
    { size, ochre: OCHRE, teal: TEAL, ink: INK },
  );

  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  await writeFile(resolve(OUT, `${size}.png`), png);
  console.log(`icon ${size}x${size} -> public/icon/${size}.png`);
}

await browser.close();
