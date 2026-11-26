// Gera os ícones do Waver a partir dos desenhos em brand/*.svg (roda no próprio Electron do projeto).
//   npm run build:icon
// Saída:
//   electron/icon.ico        16 a 256 px (pequenos com o desenho simplificado)
//   electron/icon.png        512 px (janela e Linux)
//   electron/tray/*.png      ícone da bandeja: normal, em chamada (linha de som parada), mutado e falando
//                            (8 quadros da linha de som mexendo), cada um em 1x/1.5x/2x
//   brand/waver-mascot.png   mascote em 512 px (README, redes)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const brand = (f) => fs.readFileSync(path.join(root, 'brand', f), 'utf8');
const ICON = brand('waver-icon.svg');
const SMALL = brand('waver-icon-small.svg');
const MASCOT = brand('waver-mascot.svg');

// desenha o SVG num canvas do tamanho pedido e, se houver, o selo de chamada (linha de som) no canto
function pageDraw(svg, size, badge) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    img.decode().then(() => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      if (!badge) g.drawImage(img, 0, 0, size, size);
      else {
        // ícone um pouco menor e deslocado, para o selo caber sem cobrir os olhos
        const s = Math.round(size * 0.92);
        g.drawImage(img, 0, 0, s, s);
        const w = Math.round(size * 0.66);
        const h = Math.max(6, Math.round(size * 0.46));
        const x = size - w;
        const y = size - h;
        const r = h / 2;
        g.fillStyle = '#0b1020';
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
        g.fill();
        const n = badge.bars.length;
        const bw = Math.max(1, Math.round(size * 0.08));
        const gap = Math.max(1, Math.round(size * 0.045));
        const total = n * bw + (n - 1) * gap;
        let bx = Math.round(x + (w - total) / 2);
        const maxH = h - Math.max(2, Math.round(size * 0.12));
        g.fillStyle = badge.color;
        for (const f of badge.bars) {
          const bh = Math.max(bw, Math.round(maxH * f));
          const by = Math.round(y + (h - bh) / 2);
          g.fillRect(bx, by, bw, bh);
          bx += bw + gap;
        }
      }
      resolve(c.toDataURL('image/png').split(',')[1]);
    }, () => reject(new Error('svg inválido')));
  });
}

function buildIco(entries) {
  // ICO com imagens PNG dentro (aceito pelo Windows Vista+ e pelo electron-builder)
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    header[o] = size >= 256 ? 0 : size;
    header[o + 1] = size >= 256 ? 0 : size;
    header[o + 2] = 0;
    header[o + 3] = 0;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html,<meta charset=utf-8><body></body>');
    const draw = async (svg, size, badge = null) =>
      Buffer.from(await win.webContents.executeJavaScript(`(${pageDraw.toString()})(${JSON.stringify(svg)}, ${size}, ${JSON.stringify(badge)})`), 'base64');

    // ícone do app
    const entries = [];
    for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) entries.push({ size, png: await draw(size <= 40 ? SMALL : ICON, size) });
    fs.writeFileSync(path.join(root, 'electron', 'icon.ico'), buildIco(entries));
    fs.writeFileSync(path.join(root, 'electron', 'icon.png'), await draw(ICON, 512));
    fs.writeFileSync(path.join(root, 'brand', 'waver-mascot.png'), await draw(MASCOT, 512));

    // bandeja: 16 px em 100% de escala; 24 px em 150%; 32 px em 200%
    const trayDir = path.join(root, 'electron', 'tray');
    fs.rmSync(trayDir, { recursive: true, force: true });
    fs.mkdirSync(trayDir, { recursive: true });
    const scales = [
      ['', 16],
      ['@1.5x', 24],
      ['@2x', 32],
    ];
    const GREEN = '#23d18b';
    const variants = [['tray', null], ['call-idle', { color: GREEN, bars: [0.18, 0.18, 0.18, 0.18] }], ['call-muted', { color: '#f23f42', bars: [0.18, 0.18, 0.18, 0.18] }]];
    // falando: 8 quadros de barras subindo e descendo fora de fase
    const FRAMES = 8;
    for (let i = 0; i < FRAMES; i++) {
      const t = (i / FRAMES) * Math.PI * 2;
      const bars = [0, 1, 2, 3].map((k) => Number((0.3 + 0.7 * Math.abs(Math.sin(t + k * 0.9))).toFixed(2)));
      variants.push([`call-talk-${i}`, { color: GREEN, bars }]);
    }
    for (const [name, badge] of variants) {
      for (const [suffix, size] of scales) {
        fs.writeFileSync(path.join(trayDir, `${name}${suffix}.png`), await draw(SMALL, size, badge));
      }
    }
    console.log(`[ícones] icon.ico (${entries.length} tamanhos), icon.png, waver-mascot.png e ${variants.length * scales.length} imagens da bandeja.`);
  } catch (err) {
    console.error('[ícones] falhou:', err);
    process.exitCode = 1;
  }
  app.quit();
});
