// Filtra os candidatos (fonte do Windows) pelo conjunto oficial de emoji (\p{RGI_Emoji}, ICU do Node),
// acrescenta bandeiras, marca quem aceita tom de pele e grava o JSON compacto usado pelo app.
// uso: node emoji_build.mjs emoji_candidates.json saida.json
import fs from 'node:fs';

const [, , inFile, outFile] = process.argv;
const cands = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const RGI = /^\p{RGI_Emoji}$/v;
const PRES = /^\p{Emoji_Presentation}$/u;
const ZWJ = 0x200d, VS = 0xfe0f, KEYCAP = 0x20e3;

// tenta a forma oficial: como veio, ou com FE0F depois dos códigos sem apresentação de emoji
function canonical(cps) {
  const plain = String.fromCodePoint(...cps);
  if (RGI.test(plain)) return plain;
  const out = [];
  cps.forEach((c) => {
    out.push(c);
    if (c !== ZWJ && c !== KEYCAP && !PRES.test(String.fromCodePoint(c))) out.push(VS);
  });
  const withVs = String.fromCodePoint(...out);
  if (RGI.test(withVs)) return withVs;
  // só o primeiro com FE0F (ex.: 🏳️‍🌈)
  const first = [cps[0], VS, ...cps.slice(1)];
  const f = String.fromCodePoint(...first);
  if (RGI.test(f)) return f;
  // keycap: dígito + FE0F + 20E3
  if (cps.length === 2 && cps[1] === KEYCAP) {
    const k = String.fromCodePoint(cps[0], VS, KEYCAP);
    if (RGI.test(k)) return k;
  }
  return null;
}

// tom de pele: põe o modificador depois do primeiro código (sem o FE0F dele)
function toned(e, tone = 0x1f3fd) {
  const cps = [...e].map((c) => c.codePointAt(0));
  const rest = cps.slice(1);
  if (rest[0] === VS) rest.shift();
  return String.fromCodePoint(cps[0], tone, ...rest);
}

const seen = new Set();
const list = [];
for (const c of cands) {
  const e = canonical(c.cps);
  if (!e || seen.has(e)) continue;
  seen.add(e);
  const skin = RGI.test(toned(e)) ? 1 : 0;
  list.push({ e, n: c.name.toLowerCase(), g: c.group, s: skin, cps: c.cps });
}

// bandeiras de países (pares de letras regionais) com nome em português
const regionPt = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const A = 0x1f1e6;
for (let i = 0; i < 26; i++) {
  for (let j = 0; j < 26; j++) {
    const e = String.fromCodePoint(A + i, A + j);
    if (!RGI.test(e) || seen.has(e)) continue;
    const code = String.fromCharCode(65 + i, 65 + j);
    let name = code;
    try {
      name = regionPt.of(code) || code;
    } catch {}
    seen.add(e);
    list.push({ e, n: `bandeira ${name.toLowerCase()} flag ${code.toLowerCase()}`, g: 'flags', s: 0, cps: [A + i, A + j], flag: true });
  }
}
const tagFlag = (sub, name) => {
  const e = String.fromCodePoint(0x1f3f4, ...[...sub].map((ch) => 0xe0000 + ch.charCodeAt(0)), 0xe007f);
  if (RGI.test(e) && !seen.has(e)) {
    seen.add(e);
    list.push({ e, n: `bandeira ${name} flag`, g: 'flags', s: 0, cps: [0x1f3f4], flag: true });
  }
};
tagFlag('gbeng', 'inglaterra england');
tagFlag('gbsct', 'escócia scotland');
tagFlag('gbwls', 'país de gales wales');

// correções de categoria feitas à mão depois de revisar a lista
const FIX = {
  activities: '⛳🀄🎄🎋🎴🏏🧸',
  travel: '🌬🎠🚅🦼🦽☀🗻🗾🚛🛺',
  animals: '🐱🐹🦒🦓🐽',
  people: '💆🙅🙆🙎🤦🫶💑☝🏋👆👇👈👉🕴🤌🤘🤝🫦🫵',
  symbols: '♿🚼↩↪☑',
  food: '🍖🍗🌭🍜',
  objects: '🖱🪤🗡🎒🖋🧯👓👢🔦🔪🖇🗜🦯🪞',
  smileys: '👿💕💞🤣',
};
const fixMap = new Map();
for (const [g, s] of Object.entries(FIX)) for (const ch of s) fixMap.set(ch.codePointAt(0), g);
for (const x of list) {
  if (x.flag || x.e.includes('‍')) continue;
  const g = fixMap.get(x.e.codePointAt(0));
  if (g) x.g = g;
}
// sequências ZWJ ficam na categoria do emoji base (🐻‍❄️ com 🐻, 🍋‍🟩 com 🍋, 👰‍♀️ com 👰)
const baseGroup = new Map();
for (const x of list) if (!x.e.includes('‍') && !x.flag) baseGroup.set(x.e.codePointAt(0), x.g);
for (const x of list) {
  if (!x.e.includes('‍') || x.flag) continue;
  const g = baseGroup.get(x.e.codePointAt(0));
  if (g) x.g = g;
}

const ORDER = ['smileys', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags'];
list.sort((a, b) => {
  const g = ORDER.indexOf(a.g) - ORDER.indexOf(b.g);
  if (g) return g;
  if (a.flag && b.flag) return a.n.localeCompare(b.n, 'pt');
  // Carinhas: rostos primeiro (como no painel do Windows), depois corações e símbolos de emoção
  if (a.g === 'smileys') {
    const fa = /face|smiling|grinning/.test(a.n) ? 0 : 1;
    const fb = /face|smiling|grinning/.test(b.n) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ka = a.cps[0] < 0x1f000 ? a.cps[0] + 0x20000 : a.cps[0];
    const kb = b.cps[0] < 0x1f000 ? b.cps[0] + 0x20000 : b.cps[0];
    if (ka !== kb) return ka - kb;
  }
  const ca = a.cps[0], cb = b.cps[0];
  if (ca !== cb) return ca - cb;
  return a.cps.length - b.cps.length || a.e.localeCompare(b.e);
});

const out = list.map((x) => (x.s ? [x.e, x.n, ORDER.indexOf(x.g), 1] : [x.e, x.n, ORDER.indexOf(x.g)]));
fs.writeFileSync(outFile, JSON.stringify(out));
const count = {};
for (const x of list) count[x.g] = (count[x.g] || 0) + 1;
console.log('total', list.length, count, 'skin', list.filter((x) => x.s).length, 'bytes', fs.statSync(outFile).size);
