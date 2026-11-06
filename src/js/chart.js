// 計算ツール用の簡単な折れ線グラフ(SVG)。series: [{ points: [[x, y], ...], cls: 'ac'|'ac2'|'dash', label }]
// xlog / ylog で対数軸。marks: [[x, y, 文字]] は点と注記
// 指数表記は必要な桁だけ出す(1500 を 2e+3 と丸めないように)
// 目盛りの数: 1万までは桁区切りで(ドイツ語は区切らない)、それより大きい・0.01 より小さい数は「2×10⁵」の形にする(「2e+5」は読みにくい)
// 右端の目盛りの数は右寄せにして枠からはみ出さないようにする
// 対数軸が1桁に満たないときは 1・2・5(足りなければ 1〜9)×10ⁿ の目盛り、それでも2本に満たなければ等間隔
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const big = v => v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 0.01);
const fmtTick = (v, lang, sci = big(v)) => {
  if (!sci || v === 0) return v.toLocaleString(lang, { maximumFractionDigits: 2, useGrouping: !/^de/.test(lang) }).replace(/^-/, '−');
  const [m, e] = Number(v.toPrecision(3)).toExponential().split('e');
  return `${m === '1' ? '' : `${m.replace(/^-/, '−')}×`}10${String(Number(e)).replace(/./g, c => SUP[c])}`;
};
// 1本の軸の目盛りは同じ形にそろえる(「50,000」と「10⁵」を混ぜない)
const fmtAxis = (vs, lang) => { const sci = vs.some(big); return vs.map(v => fmtTick(v, lang, sci)); };

export function lineChart(svg, { series, xlabel, ylabel, xlog = false, ylog = false, marks = [], ymin }) {
  const lang = document.documentElement.lang || 'en';
  // 描く幅が 480px 未満(スマートフォン)なら viewBox を狭くして、文字が小さくなりすぎないようにする(目盛りも少なめ)
  const cw = svg.getBoundingClientRect ? svg.getBoundingClientRect().width : 0, narrow = cw > 0 && cw < 480;
  const W = narrow ? 420 : 600, H = 320, L = 66, R = W - 16, T = 14, B = 270, maxN = narrow ? 4 : 6;
  const pts = series.flatMap(s => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xlog || x > 0) && (!ylog || y > 0));
  if (!pts.length) { svg.innerHTML = ''; return; }
  const tx = v => (xlog ? Math.log10(v) : v), ty = v => (ylog ? Math.log10(v) : v);
  let x0 = Math.min(...pts.map(p => tx(p[0]))), x1 = Math.max(...pts.map(p => tx(p[0])));
  let y0 = ymin ?? Math.min(...pts.map(p => ty(p[1]))), y1 = Math.max(...pts.map(p => ty(p[1])));
  if (!ylog && ymin === undefined) y0 = Math.min(0, y0);
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.08;
  const X = v => L + ((tx(v) - x0) / (x1 - x0)) * (R - L);
  const Y = v => B - ((ty(v) - y0) / (y1 - y0)) * (B - T);
  const lin = (a, b) => {
    const step = 10 ** Math.floor(Math.log10((b - a) / 4)); const m = [1, 2, 5, 10].find(k => (b - a) / (step * k) <= maxN) * step;
    const out = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9 * Math.abs(b || 1); v += m) out.push(+v.toPrecision(12)); return out;
  };
  const ticks = (a, b, log) => {
    if (!log) return lin(a, b);
    const k = Math.max(1, Math.ceil((Math.floor(b) - Math.ceil(a)) / (maxN + 1))), out = [];
    for (let e = Math.ceil(a); e <= Math.floor(b); e += k) out.push(10 ** e);
    if (out.length >= 3) return out;
    for (const ms of [[1, 2, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
      const sub = [];
      for (let e = Math.floor(a); e <= Math.ceil(b); e++) for (const m of ms) { const v = +(m * 10 ** e).toPrecision(12), t = Math.log10(v); if (t >= a - 1e-9 && t <= b + 1e-9) sub.push(v); }
      if (sub.length >= 3) return sub;
    }
    const l = lin(10 ** a, 10 ** b).filter(v => v > 0);
    return l.length >= 2 ? l : [10 ** a, 10 ** b];
  };
  const xt = ticks(x0, x1, xlog), yt = ticks(y0, y1, ylog), xs = fmtAxis(xt, lang), ys = fmtAxis(yt, lang);
  const line = s => s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xlog || x > 0) && (!ylog || y > 0))
    .map(([x, y], k) => `${k ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.min(Math.max(y, ylog ? 10 ** y0 : y0), ylog ? 10 ** y1 : y1)).toFixed(1)}`).join('');
  const color = { ac: 'var(--accent)', ac2: 'var(--ok)', dash: 'var(--muted)', ng: 'var(--ng)' };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = xt.map((v, i) => `<line x1="${X(v)}" y1="${T}" x2="${X(v)}" y2="${B}" stroke="var(--border)"/><text x="${X(v) > R - 24 ? W - 2 : X(v)}" y="${B + 18}" font-size="14" fill="var(--muted)" text-anchor="${X(v) > R - 24 ? 'end' : 'middle'}">${xs[i]}</text>`).join('')
    + yt.map((v, i) => `<line x1="${L}" y1="${Y(v)}" x2="${R}" y2="${Y(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${Y(v) + 5}" font-size="14" fill="var(--muted)" text-anchor="end">${ys[i]}</text>`).join('')
    + `<text x="${(L + R) / 2}" y="${H - 8}" font-size="15" fill="var(--text)" text-anchor="middle">${xlabel}</text>`
    + `<text x="16" y="${(T + B) / 2}" font-size="15" fill="var(--text)" text-anchor="middle" transform="rotate(-90 16 ${(T + B) / 2})">${ylabel}</text>`
    + series.map(s => `<path d="${line(s)}" fill="none" stroke="${color[s.cls] ?? color.ac}" stroke-width="${s.cls === 'dash' ? 1.5 : 3}"${s.cls === 'dash' ? ' stroke-dasharray="6 4"' : ''}/>`).join('')
    + marks.map(([x, y, t]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="5" fill="var(--ng)"/><text x="${Math.min(X(x) + 8, R - 4)}" y="${Y(y) - 8}" font-size="14" fill="var(--ng)" text-anchor="${X(x) > R - 120 ? 'end' : 'start'}">${t}</text>`).join('');
}
