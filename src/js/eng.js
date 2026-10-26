// 電子回路の計算ツールで共通に使うもの: SI接頭辞つきの表示(4.7 kΩ など)と、抵抗のE系列
const lang = document.documentElement.lang || 'en';
const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

export const num = (x, d = 3) => (Number.isFinite(x) ? x.toLocaleString(lang, { maximumSignificantDigits: d }) : '–');

// 値に合う接頭辞を選んで「数値 接頭辞単位」にする(丸めて 1000 になるときは次の接頭辞へ)
export function si(x, unit, d = 3) {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return `0 ${unit}`;
  const a = Math.abs(x);
  const i = PREFIX.findIndex(([f]) => a >= f);
  let [f, p] = PREFIX[i === -1 ? PREFIX.length - 1 : i];
  if (Number(Math.abs(x / f).toPrecision(d)) >= 1000 && i > 0) [f, p] = PREFIX[i - 1];
  return `${num(x / f, d)} ${p}${unit}`;
}

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const values = (x, series) => { const e = Math.floor(Math.log10(x)); return [e - 1, e, e + 1].flatMap(k => series.map(m => Number((m * 10 ** k).toPrecision(3)))); };

// x 以上で一番小さいE系列の値(電流を上限以下に抑えたいときの抵抗など)
export const eUp = (x, series = E24) => (x > 0 ? values(x, series).find(v => v >= x * (1 - 1e-9)) : NaN);
// x に一番近いE系列の値
export const eNear = (x, series = E24) => (x > 0 ? values(x, series).reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a)) : NaN);

// 入力欄の数値(空や数でないときは既定値)
export const reader = form => (k, min = -Infinity) => {
  const v = Number(form.elements[k].value);
  return Number.isFinite(v) && v >= min ? v : Number(form.elements[k].defaultValue);
};

// 指数表記(5.91 × 10⁻¹² のように上付きの指数で)。d は有効数字
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sci = (x, d = 4) => {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const [m, e] = x.toExponential(d - 1).split('e');
  return Number(e) === 0 ? m : `${m} × 10${String(Number(e)).replace(/./g, c => SUP[c])}`;
};
