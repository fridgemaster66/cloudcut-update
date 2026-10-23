// Ikona programu (build/icon.ico) z logo CloudCut: zaokrąglony kwadrat z tęczowym gradientem i ciemnym środkiem.
// Rysowane piksel po pikselu z wygładzaniem (4×4 próbki), zapis PNG przez zlib, kilka rozmiarów w jednym ICO.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const STOPS = [[0x6b, 0x95, 0xff], [0xb0, 0x6b, 0xff], [0xff, 0x6b, 0x8b], [0xff, 0xb3, 0x5c], [0x6b, 0x95, 0xff]];
const INNER = [0x15, 0x17, 0x1c];

// odległość od zaokrąglonego prostokąta (ujemna w środku)
function sdRound(x, y, half, r) {
  const qx = Math.abs(x) - half + r, qy = Math.abs(y) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function conic(x, y) {
  // jak CSS conic-gradient(from 210deg): 0° na górze, zgodnie z ruchem wskazówek zegara
  const deg = ((Math.atan2(x, -y) * 180) / Math.PI - 210 + 720) % 360;
  const t = (deg / 360) * (STOPS.length - 1), i = Math.min(Math.floor(t), STOPS.length - 2), f = t - i;
  return STOPS[i].map((c, k) => c + (STOPS[i + 1][k] - c) * f);
}
function draw(size) {
  const px = new Uint8Array(size * size * 4), S = 4, half = size / 2;
  const outerR = size * 0.27, ring = size * 0.2, innerHalf = half * 0.94 - ring, innerR = size * 0.08;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const cx = x + (sx + 0.5) / S - half, cy = y + (sy + 0.5) / S - half;
      if (sdRound(cx, cy, half * 0.94, outerR) > 0) continue;
      const c = sdRound(cx, cy, innerHalf, innerR) <= 0 ? INNER : conic(cx, cy);
      r += c[0]; g += c[1]; b += c[2]; a++;
    }
    const o = (y * size + x) * 4;
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = (a / (S * S)) * 255; }
  }
  return px;
}
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const v of buf) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const px = draw(size), raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(png);
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head[e] = s === 256 ? 0 : s; head[e + 1] = s === 256 ? 0 : s; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, ...pngs]));
fs.writeFileSync(path.join(OUT, 'icon-256.png'), pngs.at(-1));
console.log('ikona gotowa:', path.join(OUT, 'icon.ico'));
