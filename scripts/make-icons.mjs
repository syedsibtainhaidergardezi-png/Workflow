import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the app icon set from code, so there are no binary source assets
 * to keep in sync. Run `npm run icons` after changing the design below.
 *
 * Everything is drawn in unit coordinates and supersampled 4x, so the same
 * design stays crisp from a 16px taskbar icon up to 512px.
 */

const GREEN = [37, 211, 102];
const FOLD = [18, 146, 74];
const WHITE = [255, 255, 255];
const SS = 4; // supersampling factor

/** Signed-distance-ish coverage test for a rounded rectangle. */
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** Paints one supersampled pixel; returns [r,g,b,a] in unit coords. */
function shade(x, y) {
  const note = inRoundedRect(x, y, 0.08, 0.06, 0.92, 0.94, 0.13);
  if (!note) return null;

  // Diagonal cut at the bottom-right corner, with a darker fold behind it.
  const cut = x + y > 1.6;
  if (cut) return x + y > 1.72 ? null : FOLD;

  // Three text lines; the last one is short, the way a real note looks.
  for (const [top, right] of [
    [0.28, 0.76],
    [0.45, 0.76],
    [0.62, 0.58],
  ]) {
    if (y >= top && y <= top + 0.085 && x >= 0.22 && x <= right) {
      return inRoundedRect(x, y, 0.22, top, right, top + 0.085, 0.042) ? WHITE : GREEN;
    }
  }

  return GREEN;
}

function render(size) {
  const n = size * SS;
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / n;
          const y = (py * SS + sy + 0.5) / n;
          const c = shade(x, y);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          hits++;
        }
      }

      const i = (py * size + px) * 4;
      const total = SS * SS;
      if (hits) {
        out[i] = Math.round(r / hits);
        out[i + 1] = Math.round(g / hits);
        out[i + 2] = Math.round(b / hits);
        out[i + 3] = Math.round((hits / total) * 255);
      }
    }
  }

  return out;
}

// ------------------------------------------------------------- PNG encoding

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- ICO container

/** Packs PNGs into an .ico (PNG-in-ICO, supported on Windows Vista+). */
function toIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;

  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    dir[at] = size >= 256 ? 0 : size; // 0 means 256
    dir[at + 1] = size >= 256 ? 0 : size;
    dir[at + 2] = 0; // palette
    dir[at + 3] = 0; // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ---------------------------------------------------------------------- main

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(root, 'build');
mkdirSync(buildDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const entries = icoSizes.map((size) => ({ size, png: toPng(render(size), size) }));

writeFileSync(join(buildDir, 'icon.ico'), toIco(entries));
writeFileSync(join(buildDir, 'icon.png'), toPng(render(512), 512));

// The tray icon is inlined into the source so it works from a bare clone.
const tray = toPng(render(32), 32).toString('base64');
console.log(`build/icon.ico  (${icoSizes.join(', ')})`);
console.log('build/icon.png  (512)');
console.log('\ntray base64 for src/main/icon.ts:\n');
console.log(tray.replace(/(.{76})/g, '$1\n'));
