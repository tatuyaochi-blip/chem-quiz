// 緩衝液のpH(ヘンダーソン・ハッセルバルヒの式)。pH = pKa + log10([A⁻]/[HA])。
// 目標のpHから必要な比 [A⁻]/[HA] = 10^(pH − pKa) と、全濃度を保ったときの各成分の濃度も出す
import { num, reader } from './eng.js';
const form = document.getElementById('bf-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const val = reader(form);
const T = JSON.parse(form.dataset.text);

function update() {
  const pka = val('pka'), ha = val('ha', 0), a = val('a', 0), target = val('target'), total = val('total', 0);
  const ph = ha > 0 && a > 0 ? pka + Math.log10(a / ha) : NaN;
  out('ph').textContent = Number.isFinite(ph) ? num(ph, 4) : '–';
  out('range').textContent = Number.isFinite(ph) && Math.abs(ph - pka) > 1 ? T.outside : T.inside;
  const r = 10 ** (target - pka);
  out('ratio').textContent = num(r, 4);
  out('c-a').textContent = `${num(total * r / (1 + r), 4)} mol/L`;
  out('c-ha').textContent = `${num(total / (1 + r), 4)} mol/L`;
}
form.addEventListener('input', update);
form.addEventListener('submit', e => e.preventDefault());
update();
