// アプリのアイコン(PNG)を作る。ロゴと同じグラデーションの上に、白い図柄(分野ごとに選ぶ)を描く。
// 外部ライブラリを使わず、zlib だけで PNG を組み立てる。
import zlib from 'node:zlib';

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const PINS = [0.37, 0.457, 0.543, 0.63]; // ピンの中心(辺に沿った位置)

// 図柄: 位置 (u, v)(0〜1)が白い図柄の上にあるか。config.json の icon.glyph で選ぶ
const GLYPHS = {
  // チップ(半導体)
  chip(u, v) {
    const inBox = (a, b) => u >= a && u <= b && v >= a && v <= b;
    if (inBox(0.3, 0.7)) return !inBox(0.4, 0.6);
    const pin = (along, across) => across >= 0.22 && across < 0.3 && PINS.some(p => Math.abs(along - p) <= 0.022);
    return pin(u, v) || pin(u, 1 - v) || pin(v, u) || pin(v, 1 - u);
  },
  // 結晶格子(3×3 の原子と結合)
  lattice(u, v) {
    const P = [0.28, 0.5, 0.72];
    const atom = P.some(a => P.some(b => (u - a) ** 2 + (v - b) ** 2 <= 0.055 ** 2));
    const bond = (P.some(a => Math.abs(v - a) <= 0.012) && u >= 0.28 && u <= 0.72) || (P.some(a => Math.abs(u - a) <= 0.012) && v >= 0.28 && v <= 0.72);
    return atom || bond;
  },
  // 凸レンズと光線
  lens(u, v) {
    const r = 0.36, d = 0.27; // 2つの円の重なりがレンズ
    const lens = (u - 0.5 + d) ** 2 + (v - 0.5) ** 2 <= r * r && (u - 0.5 - d) ** 2 + (v - 0.5) ** 2 <= r * r;
    const ray = u >= 0.16 && u <= 0.84 && [0.38, 0.62].some(y => Math.abs(v - (u <= 0.5 ? y : y + (0.5 - y) * (u - 0.5) / 0.34)) <= 0.014);
    return lens || ray;
  },
  // ベンゼン環(六角形と内側の円)
  benzene(u, v) {
    const x = u - 0.5, y = v - 0.5, R = 0.26;
    const hex = Math.max(Math.abs(y), Math.abs(y) / 2 + Math.abs(x) * Math.sqrt(3) / 2); // 頂点が上下の六角形
    const ring = hex <= R * Math.sqrt(3) / 2 + 0.03 && hex >= R * Math.sqrt(3) / 2 - 0.03;
    const r = Math.hypot(x, y);
    return ring || (r <= 0.135 && r >= 0.105);
  },
  // 蒸留塔(縦の塔と段)
  column(u, v) {
    const wall = (Math.abs(u - 0.38) <= 0.025 || Math.abs(u - 0.62) <= 0.025) && v >= 0.2 && v <= 0.8;
    const cap = (Math.abs(v - 0.2) <= 0.025 || Math.abs(v - 0.8) <= 0.025) && u >= 0.38 && u <= 0.62;
    const tray = [0.35, 0.5, 0.65].some(y => Math.abs(v - y) <= 0.014) && u >= 0.38 && u <= 0.62;
    return wall || cap || tray;
  },
  // 電波(アンテナと円弧)
  wave(u, v) {
    const mast = Math.abs(u - 0.5) <= 0.022 && v >= 0.5 && v <= 0.8;
    const base = Math.abs(v - 0.8) <= 0.022 && u >= 0.4 && u <= 0.6;
    const r = Math.hypot(u - 0.5, v - 0.5);
    const up = v <= 0.5 + 0.08 && Math.abs(u - 0.5) <= (0.5 + 0.12 - v) * 1.4;
    const arcs = [0.08, 0.17, 0.26].some(a => Math.abs(r - a) <= 0.02) && up;
    return mast || base || arcs;
  },
};

export function iconPng(size, { c1 = '#1d64c8', c2 = '#0b8f72', glyph = 'chip' } = {}) {
  const C1 = hex(c1), C2 = hex(c2), isWhite = GLYPHS[glyph] ?? GLYPHS.chip;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // 先頭の 0 はフィルタなし
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const rgb = isWhite((x + 0.5) / size, (y + 0.5) / size) ? [255, 255, 255] : C1.map((c, i) => Math.round(c + (C2[i] - c) * t));
      row.set([...rgb, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
