'use strict';
/**
 * Generates assets/icon.png, assets/icon.ico, assets/icon.icns
 * from assets/source.png (if present) using nearest-neighbour scaling,
 * or falls back to the programmatic orange-cat icon.
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

// ── PNG encoder ───────────────────────────────────
function pixelsToPNG(size, pixels) {
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
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])), 0);
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

// ── PNG decoder ───────────────────────────────────
function decodePNG(buf) {
  let pos = 8; // skip 8-byte signature
  let W, H, bpp;
  const idats = [];

  while (pos < buf.length) {
    const len  = buf.readUInt32BE(pos); pos += 4;
    const type = buf.toString('ascii', pos, pos + 4); pos += 4;
    const data = buf.slice(pos, pos + len); pos += len + 4; // +4 for CRC

    if (type === 'IHDR') {
      W = data.readUInt32BE(0);
      H = data.readUInt32BE(4);
      const ct = data[9]; // 2=RGB, 6=RGBA
      bpp = ct === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') break;
  }

  const raw    = zlib.inflateSync(Buffer.concat(idats));
  const stride = 1 + W * bpp;
  const recon  = Buffer.alloc(H * W * bpp, 0);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  for (let y = 0; y < H; y++) {
    const f = raw[y * stride];
    for (let x = 0; x < W * bpp; x++) {
      const ri  = y * W * bpp + x;
      const rUp   = y > 0          ? recon[(y - 1) * W * bpp + x]       : 0;
      const rLeft = x >= bpp       ? recon[ri - bpp]                     : 0;
      const rUL   = y > 0 && x >= bpp ? recon[(y - 1) * W * bpp + x - bpp] : 0;
      let v = raw[y * stride + 1 + x];
      if      (f === 1) v = (v + rLeft)                                   & 0xFF;
      else if (f === 2) v = (v + rUp)                                     & 0xFF;
      else if (f === 3) v = (v + Math.floor((rLeft + rUp) / 2))           & 0xFF;
      else if (f === 4) v = (v + paeth(rLeft, rUp, rUL))                  & 0xFF;
      recon[ri] = v;
    }
  }

  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * bpp, d = (y * W + x) * 4;
      out[d] = recon[s]; out[d+1] = recon[s+1]; out[d+2] = recon[s+2];
      out[d+3] = bpp === 4 ? recon[s+3] : 255;
    }

  return { width: W, height: H, pixels: out };
}

// ── Nearest-neighbour scale ────────────────────────
function scalePixels(src, dstSize) {
  const { width, height, pixels } = src;
  const out = Buffer.alloc(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++)
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.floor(x * width  / dstSize);
      const sy = Math.floor(y * height / dstSize);
      const si = (sy * width + sx) * 4, di = (y * dstSize + x) * 4;
      out[di] = pixels[si]; out[di+1] = pixels[si+1];
      out[di+2] = pixels[si+2]; out[di+3] = pixels[si+3];
    }
  return { width: dstSize, height: dstSize, pixels: out };
}

// ── Fallback: programmatic orange-cat icon ─────────
function drawIconFallback(x, y, size) {
  const cx = size / 2, cy = size / 2, r = size * 0.44;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  if (dist > r) return [0, 0, 0, 0];
  const earR = size * 0.12, earY = cy - r * 0.78, earX = size * 0.22;
  const lEar = Math.sqrt((x - (cx - earX)) ** 2 + (y - earY) ** 2);
  const rEar = Math.sqrt((x - (cx + earX)) ** 2 + (y - earY) ** 2);
  if (lEar < earR || rEar < earR) return [0xDA, 0x77, 0x56, 255];
  const eyeR = size * 0.07, eyeY = cy - size * 0.05, eyeX = size * 0.15;
  if (Math.sqrt((x-(cx-eyeX))**2 + (y-eyeY)**2) < eyeR) return [0x7C, 0x3A, 0xED, 255];
  if (Math.sqrt((x-(cx+eyeX))**2 + (y-eyeY)**2) < eyeR) return [0x7C, 0x3A, 0xED, 255];
  if (Math.sqrt((x-cx)**2 + (y-(cy+size*0.08))**2) < size * 0.025)
    return [0x2D, 0x1B, 0x4E, 255];
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

function makeFallbackPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = drawIconFallback(x, y, size);
      const i = (y * size + x) * 4;
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
    }
  return { width: size, height: size, pixels };
}

// ── Main ──────────────────────────────────────────
const OUT = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const SRC = path.join(OUT, 'source.png');
let base;

if (fs.existsSync(SRC)) {
  console.log('  Using source.png as icon base');
  base = decodePNG(fs.readFileSync(SRC));
} else {
  console.log('  No source.png found — using default icon');
  base = makeFallbackPixels(64);
}

const s512 = scalePixels(base, 512);
const s256 = scalePixels(base, 256);
const s128 = scalePixels(base, 128);
const s32  = scalePixels(base, 32);
const s16  = scalePixels(base, 16);

const p512 = pixelsToPNG(512, s512.pixels);
const p256 = pixelsToPNG(256, s256.pixels);
const p128 = pixelsToPNG(128, s128.pixels);
const p32  = pixelsToPNG(32,  s32.pixels);
const p16  = pixelsToPNG(16,  s16.pixels);

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
