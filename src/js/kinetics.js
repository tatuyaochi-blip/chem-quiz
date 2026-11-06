// 反応速度。速度 −d[A]/dt = k[A]ⁿ の積分形: 0次 [A] = [A]₀ − kt、1次 [A] = [A]₀e^(−kt)、2次 1/[A] = 1/[A]₀ + kt。
// 半減期は 0次 [A]₀/(2k)、1次 ln2/k、2次 1/(k[A]₀)。アレニウスの式 Ea = R ln(k₂/k₁)/(1/T₁ − 1/T₂)、A = k₁ exp(Ea/RT₁)
import { num, sci, reader } from './eng.js';
import { lineChart } from './chart.js';
import { R, conc, halfLife, t90 as time90, arrhenius } from './chemcalc.js';
const form = document.getElementById('kn-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const val = reader(form);
const T = JSON.parse(form.dataset.text);
const lang = document.documentElement.lang || 'en';
// 負号は「−」(U+2212)に。−0 は 0 として出す
const minus = s => s.replace(/^-/, '−');
// 有効数字 d 桁で、末尾の 0 も残す(500.0 s、60.00 %)
const fix = (x, d = 4) => (!Number.isFinite(x) ? '–' : x === 0 ? '0' : minus(x.toLocaleString(lang, { minimumSignificantDigits: d, maximumSignificantDigits: d })));
const sciM = (x, d = 4) => (x === 0 ? '0' : minus(sci(x, d)));

const time = s => `${fix(s, 4)} s`;

function update() {
  const n = Number(form.elements.order.value);
  // 負の値は既定値に戻さず、結果を「–」にする
  const a0 = val('a0'), k = val('k'), t = val('t');
  const ok = a0 > 0 && k > 0 && t >= 0;
  const a = ok ? conc(n, a0, k, t) : NaN;
  const half = halfLife(n, a0, k);
  const t90 = time90(n, a0, k);
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
  const { ea } = arrhenius(T1, k1, T2, k2);
  out('ea').textContent = Number.isFinite(ea) ? `${fix(ea / 1000, 4)} kJ/mol` : '–';
  out('pre').textContent = Number.isFinite(ea) ? sciM(k1 * Math.exp(ea / (R * T1)), 4) : '–';
  out('slope').textContent = Number.isFinite(ea) ? `${sciM(-ea / R, 4)} K` : '–';
}
form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', e => e.preventDefault());
update();
