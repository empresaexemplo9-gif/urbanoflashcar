// Generates the PWA / app icons with no third-party dependency: a dark
// rounded brand tile with the UrbanoFlashCar lightning bolt, encoded to PNG
// using only node:zlib. Run with: node scripts/gen-icons.mjs
//
// Deterministic output, so the committed icons can be regenerated and reviewed.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [21, 26, 33, 255]; // #151a21 (brand dark)
const FG = [255, 210, 30, 255]; // #ffd21e (brand yellow)

// Lightning bolt polygon in a 0..100 box.
const BOLT = [
  [58, 6], [26, 54], [46, 54], [42, 94], [74, 42], [52, 42], [58, 6],
];

// CRC32 (PNG chunk checksum).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function render(size, boltScale) {
  const px = Buffer.alloc(size * size * 4);
  const corner = size * 0.18; // rounded-corner radius for a soft tile
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-corner transparency so the tile looks good unmasked.
      let color = inRoundedRect(x, y, size, corner) ? BG : [0, 0, 0, 0];
      px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = color[3];
    }
  }
  const box = size * boltScale;
  const off = (size - box) / 2;
  const pts = BOLT.map(([x, y]) => [off + (x / 100) * box, off + (y / 100) * box]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, pts)) {
        const i = (y * size + x) * 4;
        px[i] = FG[0]; px[i + 1] = FG[1]; px[i + 2] = FG[2]; px[i + 3] = FG[3];
      }
    }
  }
  return encodePng(size, size, px);
}

function inRoundedRect(x, y, size, r) {
  const nx = Math.min(x, size - 1 - x);
  const ny = Math.min(y, size - 1 - y);
  if (nx >= r || ny >= r) return true;
  const dx = r - nx;
  const dy = r - ny;
  return dx * dx + dy * dy <= r * r;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, 0.6],
  ['icon-512.png', 512, 0.6],
  ['maskable-512.png', 512, 0.46], // smaller bolt inside the maskable safe area
  ['apple-touch-icon.png', 180, 0.6],
];
for (const [name, size, scale] of targets) {
  writeFileSync(join(OUT, name), render(size, scale));
  console.log('wrote', name);
}
