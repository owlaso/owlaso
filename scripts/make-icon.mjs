import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const OUT  = resolve(ROOT, 'build');
mkdirSync(OUT, { recursive: true });

const BG     = [0xff, 0xff, 0xff];
const ACCENT = [0x63, 0x66, 0xf1];

function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function renderPNG(SIZE) {
  const S       = SIZE / 80;
  const CR      = 20   * S;
  const RCX     = 40   * S, RCY = 40 * S;
  const RR      = 26   * S;
  const RHW     = 1.25 * S;
  const DCX     = 54.9 * S, DCY = 18.7 * S;
  const DR      = 6    * S;

  function boxSDF(px, py) {
    const qx = Math.abs(px - SIZE / 2) - (SIZE / 2 - CR);
    const qy = Math.abs(py - SIZE / 2) - (SIZE / 2 - CR);
    return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2)
         + Math.min(Math.max(qx, qy), 0) - CR;
  }

  const raw = new Uint8Array(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y++) {
    const row = y * (1 + SIZE * 4);
    raw[row] = 0;
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5, py = y + 0.5;
      const bgA  = clamp(0.5 - boxSDF(px, py));
      const rd   = Math.sqrt((px - RCX) ** 2 + (py - RCY) ** 2);
      const rA   = clamp(0.5 - (Math.abs(rd - RR) - RHW));
      const dd   = Math.sqrt((px - DCX) ** 2 + (py - DCY) ** 2);
      const dA   = clamp(DR + 0.5 - dd);
      const acc  = 1 - (1 - rA) * (1 - dA);
      const o    = row + 1 + x * 4;
      raw[o]   = Math.round(BG[0] * (1-acc) + ACCENT[0] * acc);
      raw[o+1] = Math.round(BG[1] * (1-acc) + ACCENT[1] * acc);
      raw[o+2] = Math.round(BG[2] * (1-acc) + ACCENT[2] * acc);
      raw[o+3] = Math.round(bgA * 255);
    }
  }

  // PNG encoder
  const crcTab = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTab[i] = c;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = crcTab[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function u32(n) { return Buffer.from([(n>>>24)&0xFF,(n>>>16)&0xFF,(n>>>8)&0xFF,n&0xFF]); }
  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
  }

  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', Buffer.concat([u32(SIZE), u32(SIZE), Buffer.from([8,6,0,0,0])])),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO: header + one directory entry + embedded PNG (256x256)
function makeICO(pngBuf) {
  // ICONDIR header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // count = 1

  // ICONDIRENTRY (16 bytes)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0,  0);              // width  0 = 256
  entry.writeUInt8(0,  1);              // height 0 = 256
  entry.writeUInt8(0,  2);             // colorCount
  entry.writeUInt8(0,  3);             // reserved
  entry.writeUInt16LE(1, 4);           // planes
  entry.writeUInt16LE(32, 6);          // bitCount
  entry.writeUInt32LE(pngBuf.length, 8); // bytesInRes
  entry.writeUInt32LE(6 + 16, 12);      // imageOffset = header + 1 entry

  return Buffer.concat([header, entry, pngBuf]);
}

// Generate sizes
const png1024 = renderPNG(1024);
const png256  = renderPNG(256);
const ico     = makeICO(png256);

writeFileSync(resolve(OUT, 'icon.png'), png1024);
writeFileSync(resolve(OUT, 'icon.ico'), ico);
console.log(`icon.png  ${Math.round(png1024.length/1024)} KB`);
console.log(`icon.ico  ${Math.round(ico.length/1024)} KB`);
