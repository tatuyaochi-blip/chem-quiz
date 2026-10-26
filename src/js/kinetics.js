// 反応速度。速度 −d[A]/dt = k[A]ⁿ の積分形: 0次 [A] = [A]₀ − kt、1次 [A] = [A]₀e^(−kt)、2次 1/[A] = 1/[A]₀ + kt。
// 半減期は 0次 [A]₀/(2k)、1次 ln2/k、2次 1/(k[A]₀)。アレニウスの式 Ea = R ln(k₂/k₁)/(1/T₁ − 1/T₂)、A = k₁ exp(Ea/RT₁)
import { num, sci, reader } from './eng.js';
import { lineChart } from './chart.js';
const form = document.getElementById('kn-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const val = reader(form);
const T = JSON.parse(form.dataset.text);
const R = 8.314;
const lang = document.documentElement.lang || 'en';
// 負号は「−」(U+2212)に。−0 は 0 として出す
const minus = s => s.replace(/^-/, '−');
// 有効数字 d 桁で、末尾の 0 も残す(500.0 s、60.00 %)
const fix = (x, d = 4) => (!Number.isFinite(x) ? '–' : x === 0 ? '0' : minus(x.toLocaleString(lang, { minimumSignificantDigits: d, maximumSignificantDigits: d })));
const sciM = (x, d = 4) => (x === 0 ? '0' : minus(sci(x, d)));

// 時間 t での濃度(0次は 0 で止まる)
const conc = (n, a0, k, t) => (n === 0 ? Math.max(a0 - k * t, 0) : n === 1 ? a0 * Math.exp(-k * t) : a0 / (1 + k * a0 * t));
const time = s => `${fix(s, 4)} s`;

function update() {
  const n = Number(form.elements.order.value);
  // 負の値は既定値に戻さず、結果を「–」にする
  const a0 = val('a0'), k = val('k'), t = val('t');
  const ok = a0 > 0 && k > 0 && t >= 0;
  const a = ok ? conc(n, a0, k, t) : NaN;
  const half = n === 0 ? a0 / (2 * k) : n === 1 ? Math.LN2 / k : 1 / (k * a0);
  const t90 = n === 0 ? 0.9 * a0 / k : n === 1 ? Math.LN10 / k : 9 / (k * a0);
  out('conc').textContent = ok ? `${sciM(a, 4)} mol/L` : '–';
  out('conv').textContent = ok ? `${fix(100 * (1 - a / a0), 4)} %` : '–';
  out('half').textContent = ok ? time(half) : '–';
  out('t90').textContent = ok ? time(t90) : '–';
  out('unit').textContent = T.units[n];

  // 横軸は経過時間の1.25倍か半減期の3倍の長いほう
  const svg = document.getElementById('kn-chart');
  if (ok) {
    const xmax = Math.max(t * 1.25, half * 3);
    const points = Array.from({ length: 121 }, (_, i) => { const x = (xmax * i) / 120; return [x, conc(n, a0, k, x)]; });
    lineChart(svg, { series: [{ points }], xlabel: T.xlabel, ylabel: T.ylabel, marks: [[t, a, `t = ${num(t, 4)} s`]] });
  } else svg.innerHTML = '';

  // アレニウスの式(温度は ℃ で入れて K に直す)
  const T1 = val('t1') + 273.15, T2 = val('t2') + 273.15, k1 = val('k1'), k2 = val('k2');
  const inv = 1 / T1 - 1 / T2;
  const ea = T1 > 0 && T2 > 0 && k1 > 0 && k2 > 0 && inv !== 0 ? (R * Math.log(k2 / k1)) / inv : NaN;
  out('ea').textContent = Number.isFinite(ea) ? `${fix(ea / 1000, 4)} kJ/mol` : '–';
  out('pre').textContent = Number.isFinite(ea) ? sciM(k1 * Math.exp(ea / (R * T1)), 4) : '–';
  out('slope').textContent = Number.isFinite(ea) ? `${sciM(-ea / R, 4)} K` : '–';
}
form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', e => e.preventDefault());
update();
