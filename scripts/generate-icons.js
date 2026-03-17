'use strict';
/**
 * Generates assets/icon.png, assets/icon.ico, assets/icon.icns
 * using only Node.js built-ins (no external dependencies).
 * Run automatically via: npm install (postinstall hook)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── CRC32 ─────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── PNG builder ───────────────────────────────────
function makePNG(size, colorFn) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = colorFn(x, y, size);
      const i = (y * size + x) * 4;
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
    }

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // None filter
    pixels.copy(row, 1, y * size * 4, (y + 1) * size * 4);
    rows.push(row);
  }

  function pchunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length, 0);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])), 0);
    return Buffer.concat([len, t, d, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pchunk('IHDR', ihdr),
    pchunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pchunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Icon art: orange cat face ─────────────────────
function drawIcon(x, y, size) {
  const cx = size / 2, cy = size / 2, r = size * 0.44;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  if (dist > r) return [0, 0, 0, 0];

  // Ears (two small circles above head)
  const earR = size * 0.12, earY = cy - r * 0.78, earX = size * 0.22;
  const lEar = Math.sqrt((x - (cx - earX)) ** 2 + (y - earY) ** 2);
  const rEar = Math.sqrt((x - (cx + earX)) ** 2 + (y - earY) ** 2);
  if (lEar < earR || rEar < earR) return [0xDA, 0x77, 0x56, 255];

  // Eyes
  const eyeR = size * 0.07, eyeY = cy - size * 0.05, eyeX = size * 0.15;
  if (Math.sqrt((x-(cx-eyeX))**2 + (y-eyeY)**2) < eyeR) return [0x7C, 0x3A, 0xED, 255];
  if (Math.sqrt((x-(cx+eyeX))**2 + (y-eyeY)**2) < eyeR) return [0x7C, 0x3A, 0xED, 255];

  // Nose
  if (Math.sqrt((x-cx)**2 + (y-(cy+size*0.08))**2) < size * 0.025)
    return [0x2D, 0x1B, 0x4E, 255];

  // Cream belly (inner gradient)
  if (dist < r * 0.62 && y > cy - size * 0.04) {
    const t = dist / (r * 0.62);
    return [
      Math.round(0xFA * (1-t) + 0xDA * t),
      Math.round(0xF7 * (1-t) + 0x77 * t),
      Math.round(0xF0 * (1-t) + 0x56 * t),
      255,
    ];
  }

  return [0xDA, 0x77, 0x56, 255];
}

// ── Generate sizes ────────────────────────────────
const OUT = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const p512 = makePNG(512, drawIcon);
const p256 = makePNG(256, drawIcon);
const p128 = makePNG(128, drawIcon);
const p32  = makePNG(32,  drawIcon);
const p16  = makePNG(16,  drawIcon);

fs.writeFileSync(path.join(OUT, 'icon.png'), p512);
console.log('  icon.png  (512×512)');

// ── ICO (Windows) ─────────────────────────────────
{
  const imgs  = [p256, p128, p32, p16];
  const sizes = [256, 128, 32, 16];
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(imgs.length, 4);

  let offset = 6 + imgs.length * 16;
  const dirs = imgs.map((img, i) => {
    const e = Buffer.alloc(16);
    const s = sizes[i];
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12);
    offset += img.length;
    return e;
  });

  fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([hdr, ...dirs, ...imgs]));
  console.log('  icon.ico  (multi-size)');
}

// ── ICNS (macOS) ──────────────────────────────────
{
  function icnsEntry(type, data) {
    const hdr = Buffer.alloc(8);
    hdr.write(type, 0, 'ascii');
    hdr.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([hdr, data]);
  }
  const body = Buffer.concat([icnsEntry('ic09', p512), icnsEntry('ic08', p256)]);
  const hdr  = Buffer.alloc(8);
  hdr.write('icns', 0, 'ascii');
  hdr.writeUInt32BE(8 + body.length, 4);
  fs.writeFileSync(path.join(OUT, 'icon.icns'), Buffer.concat([hdr, body]));
  console.log('  icon.icns (512+256)');
}

console.log('Icons ready.');
