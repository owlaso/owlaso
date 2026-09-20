// Renders the OwlASO icon and writes build/icon.png + build/icon.ico
// Run: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0}body{background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1024" height="1024"></canvas>
<script>
const svg = \`<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#4338ca"/>
    </linearGradient>
    <radialGradient id="glow" cx="512" cy="380" r="580" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="white" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.14"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <polygon points="348,272 296,118 458,248" fill="white" opacity="0.94"/>
  <polygon points="676,272 728,118 566,248" fill="white" opacity="0.94"/>
  <circle cx="512" cy="570" r="308" fill="white" opacity="0.07"/>
  <circle cx="512" cy="570" r="308" fill="none" stroke="white" stroke-width="22" opacity="0.86"/>
  <circle cx="400" cy="518" r="102" fill="white" opacity="0.16"/>
  <circle cx="400" cy="518" r="102" fill="none" stroke="white" stroke-width="18"/>
  <circle cx="400" cy="518" r="46" fill="white"/>
  <circle cx="418" cy="500" r="14" fill="white" opacity="0.5"/>
  <circle cx="624" cy="518" r="102" fill="white" opacity="0.16"/>
  <circle cx="624" cy="518" r="102" fill="none" stroke="white" stroke-width="18"/>
  <circle cx="624" cy="518" r="46" fill="white"/>
  <circle cx="642" cy="500" r="14" fill="white" opacity="0.5"/>
  <polygon points="476,624 512,680 548,624" fill="white" opacity="0.88"/>
</svg>\`;
const blob = new Blob([svg], {type:'image/svg+xml'});
const url = URL.createObjectURL(blob);
const img = new Image();
img.onload = () => {
  const ctx = document.getElementById('c').getContext('2d');
  ctx.drawImage(img, 0, 0, 1024, 1024);
  URL.revokeObjectURL(url);
  window.__done = true;
};
img.src = url;
<\/script></body></html>`;

// Encode raw RGBA (top-down) rows as a 32-bit BMP bitmap suitable for ICO entries.
// Standard ICO BMP layout: BITMAPINFOHEADER + BGR(A) pixel data bottom-up + AND mask.
function rgbaToIconBitmap(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);            // BITMAPINFOHEADER size
  header.writeInt32LE(size, 4);           // width
  header.writeInt32LE(size * 2, 8);       // height (doubled: XOR + AND)
  header.writeUInt16LE(1, 12);            // planes
  header.writeUInt16LE(32, 14);           // bpp
  header.writeUInt32LE(0, 16);            // compression (BI_RGB)
  header.writeUInt32LE(size * size * 4, 20); // image size
  header.writeInt32LE(0, 24);             // x ppm
  header.writeInt32LE(0, 28);             // y ppm
  header.writeUInt32LE(0, 32);            // colors used
  header.writeUInt32LE(0, 36);            // important colors

  // Rows are stored bottom-up; convert RGBA → BGRA.
  const pixelData = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const srcRow = y * size * 4;
    const dstRow = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x += 1) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      pixelData[di] = rgba[si + 2];       // B
      pixelData[di + 1] = rgba[si + 1];   // G
      pixelData[di + 2] = rgba[si];       // R
      pixelData[di + 3] = rgba[si + 3];   // A
    }
  }

  // AND mask: 1 row of bytes, all zero (alpha channel already carries transparency).
  const andMask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);

  return Buffer.concat([header, pixelData, andMask]);
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);             // reserved
  header.writeUInt16LE(1, 2);             // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  const bodies = [];
  entries.forEach(({ size, data }, i) => {
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16);
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2);
    dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4);     // planes
    dir.writeUInt16LE(32, i * 16 + 6);    // bpp
    dir.writeUInt32LE(data.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    offset += data.length;
    bodies.push(data);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

app.whenReady().then(async () => {
  const tmp = path.join(os.tmpdir(), 'owlaso-icon-render.html');
  fs.writeFileSync(tmp, HTML);

  const win = new BrowserWindow({
    width: 1024, height: 1024,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });

  await win.loadFile(tmp);

  // Poll until canvas is painted
  for (let i = 0; i < 30; i++) {
    const done = await win.webContents.executeJavaScript('!!window.__done');
    if (done) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // 1024×1024 PNG (used by electron-builder for Linux / macOS via conversion)
  const dataUrl1024 = await win.webContents.executeJavaScript(
    'document.getElementById("c").toDataURL("image/png")'
  );
  const png1024 = Buffer.from(dataUrl1024.split(',')[1], 'base64');
  const outDir = path.join(__dirname, '../build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.png'), png1024);
  console.log('✓ build/icon.png', (png1024.length / 1024).toFixed(0), 'KB');

  // Multi-size ICO (BMP-compressed entries) for maximal Windows compatibility.
  const sizes = [256, 48, 32, 16];
  const entries = [];
  for (const size of sizes) {
    const { data } = await win.webContents.executeJavaScript(`
      (() => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(document.getElementById('c'), 0, 0, ${size}, ${size});
        return { data: Array.from(ctx.getImageData(0, 0, ${size}, ${size}).data) };
      })()`
    );
    entries.push({ size, data: rgbaToIconBitmap(new Uint8Array(data), size) });
  }
  const ico = buildIco(entries);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('✓ build/icon.ico', (ico.length / 1024).toFixed(0), 'KB', `(${sizes.join('/')}px)`);

  fs.unlinkSync(tmp);
  app.quit();
});