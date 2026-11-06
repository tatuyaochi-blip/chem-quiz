// 酸塩基の滴定曲線。一塩基の酸(塩基)を強塩基(強酸)で滴定したときの pH を、電荷収支(Kw を含む)を数値で解いて描く。
// 滴定前・半当量点・当量点・入力した体積の pH を、教科書の近似式の値と並べ、指示薬ごとの終点の誤差から指示薬を選ぶ。計算は chemcalc.js
import { lineChart } from './chart.js';
import { titrEqVol, titrationPH, titrationApprox, indicatorErrors, bestIndicator } from './chemcalc.js';
const form = document.getElementById('ti-form');
const out = k => document.querySelector(`[data-out="${k}"]`);
const T = JSON.parse(form.dataset.text);
const lang = document.documentElement.lang || 'en';

// 小数点がコンマの言語(es・pt など)では、数値の欄を文字の欄(inputmode="decimal")にして「0,1」も「0.1」も読む。
// type="number" のままだと、ブラウザの言語が英語などのとき「4,75」のコンマが捨てられて 475 になるため。
// tool-share.js は読み込み時に欄を集め終えているので、URL への保存と結果のコピーはそのまま働く。URL の「4,75」はここで読む
const commaLang = /^(de|es|pt|fr|nl)/.test(lang);
const parse = s => { const t = String(s ?? '').trim().replace(/[\s\u00a0\u202f]/g, ''); return t === '' || (!commaLang && t.includes(',')) ? NaN : Number(t.replace(',', '.')); };
// tool-share.js が読み込み時に URL を書き直すので、開いたときの URL(ナビゲーションの記録)から読む
const params = new URLSearchParams(new URL(performance.getEntriesByType?.('navigation')[0]?.name || location.href).search);
for (const el of form.querySelectorAll('input[type="number"]')) {
  const q = params.get(el.name), fromUrl = q != null && Number.isFinite(Number(q.trim().replace(',', '.')));
  if (!commaLang) { if (fromUrl && q.includes(',')) el.value = q.trim().replace(',', '.'); continue; }
  const cur = fromUrl ? q.trim() : el.value, show = v => String(v).replace('.', ',');
  el.type = 'text';
  el.inputMode = 'decimal';
  el.autocomplete = 'off';
  el.defaultValue = show(el.defaultValue);
  el.value = show(cur);
}
// 読み直した値で URL も書き直させる(tool-share.js は change で URL を作り直す)
if ([...params.keys()].length) form.dispatchEvent(new Event('change'));
// 入力欄の数値(空や数でないときは既定値)
const val = k => { const el = form.elements[k], v = parse(el.value); return Number.isFinite(v) ? v : parse(el.defaultValue); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// 式の「_x」は下付きに(K_a → Kₐ のように)
const sub = s => esc(s).replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');
// 小数点以下 d 桁(pH は 2 桁、体積は 2 桁)。負号は「−」
const fix = (x, d = 2) => (Number.isFinite(x) ? x.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).replace(/^-/, '−') : '–');
const pct = x => (Math.abs(x) < 0.0005 ? '0 %' : `${x > 0 ? '+' : '−'}${Math.abs(x).toLocaleString(lang, { maximumSignificantDigits: 2, useGrouping: false })} %`);

// 教科書の近似式(記号は言語によらない)。酸を滴定するときと塩基を滴定するとき
const F = {
  acid: {
    weak0: '[H⁺] ≈ √(K_a·C) → pH = ½(pKa − log C)',
    strong0: 'pH = −log C',
    hh: 'pH = pKa + log(V/(Veq − V))',
    strongBefore: '[H⁺] = (C·V₀ − Ct·V)/(V₀ + V)',
    strongEq: 'pH = ½ pKw',
    weakEq: '[OH⁻] = √(K_w·Cs/K_a), Cs = C·V₀/(V₀ + Veq)',
    after: '[OH⁻] = Ct(V − Veq)/(V₀ + V)',
  },
  base: {
    weak0: '[OH⁻] ≈ √(K_b·C) → pH = pKw − ½(pKb − log C)',
    strong0: 'pH = pKw + log C',
    hh: 'pH = pKw − pKb − log(V/(Veq − V))',
    strongBefore: '[OH⁻] = (C·V₀ − Ct·V)/(V₀ + V)',
    strongEq: 'pH = ½ pKw',
    weakEq: '[H⁺] = √(K_w·Cs/K_b), Cs = C·V₀/(V₀ + Veq)',
    after: '[H⁺] = Ct(V − Veq)/(V₀ + V)',
  },
};

// グラフの枠(結果の最初の枠のあとに置く)
const box = out('chart');
box.innerHTML = `<svg class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(T.chart_label)}"></svg>`;
const svg = box.querySelector('svg');

function update() {
  const type = form.elements.type.value; // sa 強酸・wa 弱酸・sb 強塩基・wb 弱塩基
  const base = type[1] === 'b', strong = type[0] === 's';
  const pkEl = form.elements.pk;
  pkEl.disabled = strong;
  pkEl.closest('label').querySelector('span').textContent = base ? T.pkb : T.pka;
  const t = { base, strong, c: val('c'), v: val('v'), pk: val('pk'), ct: val('ct') };
  const V = val('vt');
  const ok = t.c > 0 && t.v > 0 && t.ct > 0 && V >= 0 && Number.isFinite(t.pk);
  const keys = ['veq', 'ph0', 'phhalf', 'pheq', 'jump', 'ind', 'phv', 'region'];
  if (!ok) {
    keys.forEach(k => { out(k).textContent = '–'; });
    out('points').innerHTML = out('inds').innerHTML = svg.innerHTML = '';
    return;
  }
  const veq = titrEqVol(t), ph = x => titrationPH(t, x);
  const pts = [[T.p_start, 0], [T.p_half, veq / 2], [T.p_eq, veq], [T.p_v, V]];
  out('veq').textContent = `${fix(veq)} mL`;
  out('ph0').textContent = fix(ph(0));
  out('phhalf').textContent = fix(ph(veq / 2));
  out('pheq').textContent = fix(ph(veq));
  out('jump').textContent = `${fix(ph(veq * 0.999))} → ${fix(ph(veq * 1.001))}`;
  // 終点の誤差が 1 % を超えるものしかなければ、勧めない(弱すぎる酸・薄すぎる溶液)
  const inds = indicatorErrors(t), b0 = bestIndicator(inds), best = b0 && Math.abs(b0.err) <= 1 ? b0 : null;
  out('ind').textContent = best ? T[`ind_${best.id}`] : T.ind_none;
  out('phv').textContent = fix(ph(V));
  out('region').textContent = T[`r_${titrationApprox(t, V).region}`];

  // 厳密な値と近似式の値の表
  const f = F[base ? 'base' : 'acid'];
  out('points').innerHTML = `<div class="table-wrap"><table class="dy-table">
  <thead><tr><th scope="col">${esc(T.col_point)}</th><th scope="col">V (mL)</th><th scope="col">${esc(T.col_exact)}</th><th scope="col" style="text-align:left">${esc(T.col_formula)}</th><th scope="col">${esc(T.col_approx)}</th></tr></thead>
  <tbody>${pts.map(([name, x], i) => {
    const a = titrationApprox(t, x);
    return `<tr><th scope="row">${esc(name)}</th><td data-out="pt${i}-v">${fix(x)}</td><td data-out="pt${i}-ph">${fix(ph(x))}</td><td style="text-align:left;white-space:normal;min-width:11em">${sub(f[a.f])}</td><td data-out="pt${i}-ap">${fix(a.ph)}</td></tr>`;
  }).join('')}</tbody></table></div>`;

  // 指示薬ごとの変色域と終点の誤差(変色域の中央で止めたとき)
  out('inds').innerHTML = `<div class="table-wrap"><table class="dy-table">
  <thead><tr><th scope="col">${esc(T.col_ind)}</th><th scope="col">${esc(T.col_range)}</th><th scope="col">${esc(T.col_err)}</th><th scope="col" style="text-align:left">${esc(T.col_judge)}</th></tr></thead>
  <tbody>${inds.map(x => {
    const e = Math.abs(x.err);
    const judge = x === best ? T.j_best : !Number.isFinite(x.err) ? (x.before ? T.j_before : T.j_never) : e <= 0.1 ? T.j_ok : e <= 1 ? T.j_warn : T.j_ng;
    return `<tr><th scope="row">${esc(T[`ind_${x.id}`])}</th><td>${fix(x.lo, 1)}–${fix(x.hi, 1)}</td><td data-out="err-${x.id}">${Number.isFinite(x.err) ? pct(x.err) : '–'}</td><td style="text-align:left">${esc(judge)}</td></tr>`;
  }).join('')}</tbody></table></div>`;

  // 曲線: 横軸は当量点の2倍(入力した体積がそれより大きければそこまで)。当量点の近くは細かく
  const xmax = Math.max(2 * veq, V * 1.1);
  const xs = Array.from({ length: 241 }, (_, i) => (xmax * i) / 240);
  for (const d of [0.1, 0.03, 0.01, 0.003, 0.001]) xs.push(veq * (1 - d), veq * (1 + d));
  xs.push(veq);
  const points = [...new Set(xs)].filter(x => x >= 0 && x <= xmax).sort((a, b) => a - b).map(x => [x, ph(x)]);
  const band = best ? [best.lo, best.hi].map(y => ({ points: [[0, y], [xmax, y]], cls: 'dash' })) : [];
  lineChart(svg, {
    series: [...band, { points }, { points: [[0, 14]], cls: 'dash' }], // 最後の1点は縦軸を pH 14 まで取るため(線は描かれない)
    xlabel: T.xlabel, ylabel: 'pH', ymin: 0,
    marks: [[veq / 2, ph(veq / 2), T.m_half], [veq, ph(veq), T.m_eq], ...(V > 0 && Math.abs(V - veq) > veq * 0.05 && Math.abs(V - veq / 2) > veq * 0.05 ? [[V, ph(V), 'V']] : [])],
  });
}
form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', e => e.preventDefault());
// 幅が変わったら描き直す(スマートフォンでは目盛りを減らす)
let w = 0;
addEventListener('resize', () => { const n = svg.getBoundingClientRect().width; if (Math.abs(n - w) > 40) { w = n; update(); } });
update();
