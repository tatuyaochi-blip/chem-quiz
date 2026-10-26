// 計算ツールの「グラフで見る」。入力を1つ選んで横軸にし、結果を1つ選んで縦軸にして、
// ほかの入力は今の値のまま、その入力だけを変えたときの結果を描く。
// calc(values) は入力の値 { 名前: 数値 } から結果 { data-out のキー: 数値 } を返す純粋な関数
import { lineChart } from './chart.js';

const text = sel => document.querySelector(sel)?.textContent.trim() ?? '';

export function initSweep({ form, calc, inputs, outputs, defaults = {}, ranges = {}, units = {} }) {
  const root = document.getElementById('sweep');
  if (!root) return () => {};
  const xSel = root.querySelector('[name="sweep-x"]'), ySel = root.querySelector('[name="sweep-y"]');
  const svg = root.querySelector('svg');
  // 選択肢の名前は、フォームの入力欄と結果の見出しから取る
  const inLabel = n => form.elements[n]?.closest('label')?.querySelector('span')?.textContent.trim() ?? n;
  // 表のセルの結果は「行の見出し – 列の見出し」にする
  const outLabel = k => {
    const el = document.querySelector(`[data-out="${k}"]`);
    if (!el) return k;
    const dt = el.closest('div')?.querySelector('dt');
    if (dt && !el.closest('table')) return dt.textContent.trim();
    const row = el.closest('tr'), table = el.closest('table');
    if (row && table) {
      const col = table.querySelectorAll('thead th')[[...row.children].indexOf(el)]?.textContent.trim();
      const head = row.querySelector('th')?.textContent.replace(/\s*\(.*?\)\s*$/, '').trim();
      return [head, col].filter(Boolean).join(' – ');
    }
    return k;
  };
  // 結果の単位は units で指定したもの、なければ表示中の文字から取る(「479 fs」なら fs)。表示の数値が calc の値と合うときだけ使う
  const outUnit = (k, value) => {
    const m = document.querySelector(`[data-out="${k}"]`)?.textContent.trim().match(/^[−-]?[\d.,\s\u00a0\u202f]*\d(.*)$/);
    const unit = m?.[1].trim();
    if (!unit || unit === '×' || !Number.isFinite(value)) return '';
    const num = m[0].slice(0, m[0].length - m[1].length).replace(/[\s\u00a0\u202f]/g, '').replace('−', '-');
    const close = x => Math.abs(x - value) <= Math.abs(value) * 0.02 + 1e-12;
    return [num.replace(/,/g, ''), num.replace(/\./g, '').replace(',', '.')].some(t => close(Number(t))) ? unit : '';
  };
  xSel.innerHTML = inputs.map(n => `<option value="${n}">${inLabel(n)}</option>`).join('');
  ySel.innerHTML = outputs.map(k => `<option value="${k}">${outLabel(k)}</option>`).join('');
  if (defaults.x) xSel.value = defaults.x;
  if (defaults.y) ySel.value = defaults.y;

  const read = () => Object.fromEntries([...form.elements].filter(el => el.name).map(el => [el.name, el.type === 'number' ? Number(el.value) : el.value]));

  function draw() {
    const v = read(), x = xSel.value, y = ySel.value, el = form.elements[x];
    const cur = Number(v[x]);
    const min = el.min !== '' ? Number(el.min) : -Infinity, max = el.max !== '' ? Number(el.max) : Infinity;
    // 範囲は今の値の 1/4〜4 倍(入力欄の下限・上限の中)。0 のときは 0〜1(上限があればその範囲)
    let lo = cur > 0 ? cur / 4 : 0, hi = cur > 0 ? cur * 4 : Number.isFinite(max) ? max : 1;
    if (cur < 0) { lo = cur * 4; hi = -cur * 4 || 1; }
    lo = Math.max(lo, min); hi = Math.min(hi, max);
    if (ranges[x]) [lo, hi] = ranges[x];
    if (!(hi > lo)) { lo = Number.isFinite(min) ? min : 0; hi = Number.isFinite(max) ? max : lo + 1; }
    const integer = el.step === '1' || el.step === '8';
    const pts = [];
    for (let k = 0; k <= 80; k++) {
      let xv = lo + ((hi - lo) * k) / 80;
      if (integer) xv = Math.round(xv);
      const r = calc({ ...v, [x]: xv })[y];
      if (Number.isFinite(r)) pts.push([xv, r]);
    }
    const now = calc(v)[y];
    const unit = units[y] ?? outUnit(y, now);
    lineChart(svg, { xlabel: inLabel(x), ylabel: unit ? `${outLabel(y)} (${unit})` : outLabel(y), series: [{ points: pts, cls: 'ac' }], marks: Number.isFinite(now) ? [[cur, now, '']] : [] });
  }
  form.addEventListener('input', e => { if (!e.target.closest('#sweep')) draw(); });
  xSel.addEventListener('change', draw);
  ySel.addEventListener('change', draw);
  root.hidden = false;
  draw();
  return draw;
}
