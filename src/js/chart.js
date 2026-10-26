// 計算ツール用の簡単な折れ線グラフ(SVG)。series: [{ points: [[x, y], ...], cls: 'ac'|'ac2'|'dash', label }]
// xlog / ylog で対数軸。marks: [[x, y, 文字]] は点と注記
// 指数表記は必要な桁だけ出す(1500 を 2e+3 と丸めないように)
const fmtTick = (v, lang) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? Number(v.toPrecision(3)).toExponential() : v.toLocaleString(lang, { maximumFractionDigits: 2 }));

export function lineChart(svg, { series, xlabel, ylabel, xlog = false, ylog = false, marks = [], ymin }) {
  const lang = document.documentElement.lang || 'en';
  const W = 600, H = 320, L = 66, R = 584, T = 14, B = 270;
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
  const ticks = (a, b, log) => {
    if (log) { const out = [], k = Math.max(1, Math.ceil((Math.floor(b) - Math.ceil(a)) / 7)); for (let e = Math.ceil(a); e <= Math.floor(b); e += k) out.push(10 ** e); return out.length >= 2 ? out : [10 ** a, 10 ** b]; }
    const step = 10 ** Math.floor(Math.log10((b - a) / 4)); const m = [1, 2, 5, 10].find(k => (b - a) / (step * k) <= 6) * step;
    const out = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) out.push(+v.toPrecision(12)); return out;
  };
  const xt = ticks(x0, x1, xlog), yt = ticks(y0, y1, ylog);
  const line = s => s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!xlog || x > 0) && (!ylog || y > 0))
    .map(([x, y], k) => `${k ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.min(Math.max(y, ylog ? 10 ** y0 : y0), ylog ? 10 ** y1 : y1)).toFixed(1)}`).join('');
  const color = { ac: 'var(--accent)', ac2: 'var(--ok)', dash: 'var(--muted)', ng: 'var(--ng)' };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = xt.map(v => `<line x1="${X(v)}" y1="${T}" x2="${X(v)}" y2="${B}" stroke="var(--border)"/><text x="${X(v)}" y="${B + 18}" font-size="14" fill="var(--muted)" text-anchor="middle">${fmtTick(v, lang)}</text>`).join('')
    + yt.map(v => `<line x1="${L}" y1="${Y(v)}" x2="${R}" y2="${Y(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${Y(v) + 5}" font-size="14" fill="var(--muted)" text-anchor="end">${fmtTick(v, lang)}</text>`).join('')
    + `<text x="${(L + R) / 2}" y="${H - 8}" font-size="15" fill="var(--text)" text-anchor="middle">${xlabel}</text>`
    + `<text x="16" y="${(T + B) / 2}" font-size="15" fill="var(--text)" text-anchor="middle" transform="rotate(-90 16 ${(T + B) / 2})">${ylabel}</text>`
    + series.map(s => `<path d="${line(s)}" fill="none" stroke="${color[s.cls] ?? color.ac}" stroke-width="${s.cls === 'dash' ? 1.5 : 3}"${s.cls === 'dash' ? ' stroke-dasharray="6 4"' : ''}/>`).join('')
    + marks.map(([x, y, t]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="5" fill="var(--ng)"/><text x="${Math.min(X(x) + 8, R - 4)}" y="${Y(y) - 8}" font-size="14" fill="var(--ng)" text-anchor="${X(x) > R - 120 ? 'end' : 'start'}">${t}</text>`).join('');
}
