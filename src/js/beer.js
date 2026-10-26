// ランベルト・ベールの法則 A = ε·c·l。透過率 T = 10^(−A)。吸光度か透過率と、ε・l から濃度を求める。
// 吸光度と透過率はどちらを書き換えても、もう一方を計算し直す
import { num, sci, reader } from './eng.js';
const form = document.getElementById('bl-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const val = reader(form);

function update(e) {
  const f = form.elements;
  if (e?.target === f.t) {
    const t = Number(f.t.value);
    if (t > 0 && t <= 100) f.abs.value = Number((-Math.log10(t / 100)).toFixed(4));
  } else if (!e || e.target === f.abs) {
    f.t.value = Number((100 * 10 ** -Number(f.abs.value)).toPrecision(4));
  }
  const A = val('abs'), eps = val('eps', 1e-12), l = val('l', 1e-9), mw = val('mw', 0);
  const c = A / (eps * l);
  out('c').textContent = `${sci(c)} mol/L`;
  out('cu').textContent = `${num(c * 1e6, 4)} µmol/L`;
  out('mg').textContent = mw > 0 ? `${num(c * mw * 1000, 4)} mg/L` : '–';
}
form.addEventListener('input', update);
form.addEventListener('submit', e => e.preventDefault());
update();
