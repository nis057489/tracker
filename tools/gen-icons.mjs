/**
 * Generates the PWA icons with no dependencies: rasterise a rounded square with
 * three bars, encode as PNG by hand (zlib comes from node core).
 *
 *   node tools/gen-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const BLUE = [42, 120, 214];
const INK = [252, 252, 251];

/* ----------------------------------------------------------------- shapes */

const insideRoundRect = (x, y, rect) => {
  const { x: rx, y: ry, w, h, r } = rect;
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r + 1e-9;
};

/**
 * `content` is the fraction of the canvas the artwork occupies: full bleed for
 * the normal icon, 60% for the maskable one so nothing lands outside the safe
 * circle a launcher may crop to.
 */
function render(size, { content = 1, bg = true } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const pad = (size * (1 - content)) / 2;
  const box = size * content;

  const bgRect = { x: pad, y: pad, w: box, h: box, r: box * 0.22 };
  // Three bars of rising height — the chart motif the app's own charts use.
  const barW = box * 0.13;
  const gap = box * 0.075;
  const groupW = barW * 3 + gap * 2;
  const left = pad + (box - groupW) / 2;
  const baseline = pad + box * 0.76;
  const heights = [0.22, 0.36, 0.52].map((f) => box * f);
  const bars = heights.map((hgt, i) => ({
    x: left + i * (barW + gap), y: baseline - hgt, w: barW, h: hgt, r: barW * 0.3,
  }));

  const SS = 3; // 3x3 supersampling, enough to keep the curves smooth
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let inkHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (bg && insideRoundRect(x, y, bgRect)) bgHits++;
          if (bars.some((bar) => insideRoundRect(x, y, bar))) inkHits++;
        }
      }
      const total = SS * SS;
      const bgA = bgHits / total;
      const inkA = inkHits / total;
      const alpha = Math.max(bgA, inkA);
      const i = (py * size + px) * 4;
      if (alpha === 0) continue;
      // Ink over background, then the whole thing over transparency.
      for (let c = 0; c < 3; c++) {
        const under = BLUE[c] * bgA;
        pixels[i + c] = Math.round((INK[c] * inkA + under * (1 - inkA)) / alpha);
      }
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

/* -------------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, { content: 1 }],
  ['icon-512.png', 512, { content: 1 }],
  ['icon-maskable-512.png', 512, { content: 0.62 }],
  ['apple-touch-icon.png', 180, { content: 1 }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), png(size, render(size, opts)));
  console.log(`wrote icons/${name} (${size}×${size})`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Time Tracker">
  <rect width="64" height="64" rx="14" fill="#2a78d6"/>
  <g fill="#fcfcfb">
    <rect x="14" y="35" width="8" height="14" rx="2.5"/>
    <rect x="28" y="26" width="8" height="23" rx="2.5"/>
    <rect x="42" y="16" width="8" height="33" rx="2.5"/>
  </g>
</svg>
`;
writeFileSync(join(OUT, 'favicon.svg'), svg);
console.log('wrote icons/favicon.svg');
