// 質量分析の同位体パターン。塩素 n 個・臭素 m 個の分子の M、M+2、M+4…の強度比は (a + b)ⁿ(c + d)ᵐ の展開の各項。
// 存在比は ³⁵Cl 0.7576・³⁷Cl 0.2424、⁷⁹Br 0.5069・⁸¹Br 0.4931。M+1 は ¹³C(1.07%)だけからの目安 n × 1.07/98.93
import { num, reader } from './eng.js';
const form = document.getElementById('ip-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const val = reader(form);
const CL = [0.7576, 0.2424], BR = [0.5069, 0.4931];
// 個数は 0〜max に収める(負の値は既定値に戻さず 0 として扱う)
const count = (k, max) => Math.min(Math.max(Math.round(val(k)), 0), max);
const lang = document.documentElement.lang || 'en';
// 有効数字 3 桁で、末尾の 0 も残す(64.0、32.0)
const fix = x => (x === 0 ? '0' : x.toLocaleString(lang, { minimumSignificantDigits: 3, maximumSignificantDigits: 3 }));

// 多項式の掛け算で、重い同位体の個数ごとの存在確率を出す
function pattern(ncl, nbr) {
  let p = [1];
  for (const [a, b] of [...Array(ncl).fill(CL), ...Array(nbr).fill(BR)]) {
    const q = Array(p.length + 1).fill(0);
    p.forEach((v, i) => { q[i] += v * a; q[i + 1] += v * b; });
    p = q;
  }
  return p;
}

function update() {
  const ncl = count('ncl', 6), nbr = count('nbr', 6), nc = count('nc', 200), m = val('m');
  const p = pattern(ncl, nbr);
  // 最も強いピークの位置は p から決める(100 * v / top が丸めで 100 ちょうどにならないことがある)
  const b = p.indexOf(Math.max(...p));
  const rel = p.map(v => (100 * v) / p[b]);
  const mz = i => (m > 0 ? ` (m/z ${num(m + 2 * i, 6)})` : '');
  const cell = i => (i < rel.length ? `${fix(rel[i])}${mz(i)}` : '–');
  ['m0', 'm2', 'm4', 'm6', 'm8'].forEach((k, i) => { out(k).textContent = cell(i); });
  out('more').textContent = rel.length > 5 ? rel.slice(5).map((v, j) => `M+${2 * (j + 5)} ${fix(v)}`).join(' · ') : '–';
  out('base').textContent = `${b ? `M+${2 * b}` : 'M'}${mz(b)}`;
  out('m1').textContent = `${fix((100 * nc * 1.07) / 98.93)} %`;
}
form.addEventListener('input', update);
form.addEventListener('submit', e => e.preventDefault());
update();
