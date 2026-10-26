// クロマトグラフィーの指標。保持係数 k = (tR − t0)/t0、分離係数 α = k2/k1、
// 分離度 Rs = 2(tR2 − tR1)/(W1 + W2)(ベースライン幅)、理論段数 N = 16(tR/W)²、理論段高 H = L/N
import { num, reader } from './eng.js';
const form = document.getElementById('ch-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const val = reader(form);
const T = JSON.parse(form.dataset.text);

function update() {
  const t0 = val('t0', 1e-9), t1 = val('tr1', 0), t2 = val('tr2', 0), w1 = val('w1', 1e-9), w2 = val('w2', 1e-9), L = val('len', 0);
  const k1 = (t1 - t0) / t0, k2 = (t2 - t0) / t0;
  const rs = 2 * (t2 - t1) / (w1 + w2);
  const n2 = 16 * (t2 / w2) ** 2;
  out('k1').textContent = num(k1, 4);
  out('k2').textContent = num(k2, 4);
  out('alpha').textContent = k1 > 0 ? num(k2 / k1, 4) : '–';
  out('rs').textContent = num(rs, 4);
  out('judge').textContent = rs >= 1.5 ? T.full : rs >= 1 ? T.partial : T.poor;
  out('n').textContent = num(n2, 4);
  out('h').textContent = L > 0 ? `${num(L * 1000 / n2, 4)} µm` : '–';
}
form.addEventListener('input', update);
form.addEventListener('submit', e => e.preventDefault());
update();
