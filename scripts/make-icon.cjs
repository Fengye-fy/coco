// Renders build/icon.png (512) and build/icon.ico (multi-size) from the coco mark. Usage: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="8" y="8" width="240" height="240" rx="58" fill="#f4efe9"/>
  <circle cx="128" cy="134" r="78" fill="#8a5a3b"/>
  <circle cx="161" cy="100" r="23" fill="#f4efe9"/>
</svg>`;
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const render = size => win.webContents.executeJavaScript(`new Promise(resolve => {
    const image = new Image();
    image.onload = () => { const c = document.querySelector('canvas'); c.width = c.height = ${size}; const g = c.getContext('2d'); g.clearRect(0, 0, ${size}, ${size}); g.drawImage(image, 0, 0, ${size}, ${size}); resolve(c.toDataURL('image/png')); };
    image.src = 'data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}';
  })`).then(url => Buffer.from(url.split(',')[1], 'base64'));
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), await render(512));
  // ICO: 6-byte header, a 16-byte entry per size, then PNG payloads (supported since Windows Vista).
  const pngs = [];
  for (const size of SIZES) pngs.push(await render(size));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(SIZES.length, 4);
  let offset = 6 + 16 * SIZES.length;
  const entries = SIZES.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(pngs[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return entry;
  });
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
  console.log(`build/icon.png, build/icon.ico (${SIZES.join('/')})`);
  app.quit();
});
