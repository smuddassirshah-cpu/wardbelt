// Decision notes: pure-Node PNG writer (zlib + CRC32) so icons are reproducible without an
// image dependency. Glyph: a horizontal belt of four squares with the third cell filled,
// white on clinical green, no gradient. Maskable variant keeps the glyph inside the central
// 80% safe zone. Run with `npm run icons`; output is committed under public/icons.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const GREEN = [0x0f, 0x6e, 0x56];
const WHITE = [0xff, 0xff, 0xff];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Belt glyph: four cells across the middle, outlined; the third filled. */
function beltPixel(size, safe) {
  const inset = size * (1 - safe) * 0.5;
  const span = size - inset * 2;
  const gap = span * 0.06;
  const cell = (span - gap * 3) / 4;
  const stroke = Math.max(2, Math.round(size * 0.035));
  const top = size / 2 - cell / 2;
  return (x, y) => {
    for (let i = 0; i < 4; i += 1) {
      const left = inset + i * (cell + gap);
      const inX = x >= left && x < left + cell;
      const inY = y >= top && y < top + cell;
      if (!(inX && inY)) {
        continue;
      }
      if (i === 2) {
        return WHITE;
      }
      const edge =
        x < left + stroke ||
        x >= left + cell - stroke ||
        y < top + stroke ||
        y >= top + cell - stroke;
      return edge ? WHITE : GREEN;
    }
    return GREEN;
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', encodePng(192, beltPixel(192, 0.8)));
writeFileSync('public/icons/icon-512.png', encodePng(512, beltPixel(512, 0.8)));
writeFileSync('public/icons/icon-maskable-512.png', encodePng(512, beltPixel(512, 0.6)));
