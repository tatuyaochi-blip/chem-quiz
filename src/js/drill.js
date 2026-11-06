// 計算ドリル(/drill/)。数値が毎回変わる計算問題を出し、答えの数値(単位つき)を判定して、途中式とよくある間違いを示す。
// 問題の型の文章・数値の範囲・許容差・pKa などのデータは data/drill.json(build.js がページに埋め込む)、計算はこのファイルの TYPES。
// 計算ツールと同じ計算は src/js/chemcalc.js の関数をそのまま使う(緩衝液・ランベルト・ベール・クロマトグラフィー・同位体・反応速度)。
// 定数は公式集・chemcalc.js と同じ(R = 8.314 J/(mol·K)、F = 96485 C/mol、25 ℃ のネルンスト勾配 0.05916 V)。
// 問題は (型, 種) で決まる(同じ種なら同じ数値)。種は URL の ?t=型&s=種 に残し、答えは URL に入れない。
// 問題文の数値は表示する桁に丸めてから答えを計算する(表示した数値で解けば、丸めの差で不正解にならない)。
// 検算: review の drill-chem/check/check_drill.py(python で式を別に書き、多くの種で突き合わせる)
import { bufferPH, bufferMix, absFromT, beerConc, retentionFactor, resolution, plates, platesHalf, isotopePattern, CL, BR, mPlus1, R as RGAS, conc as rateConc, halfLife, arrhenius } from './chemcalc.js';

// ---- 数の書き方(言語の小数点。桁区切りは使わない) ----
let LANG = typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en';
// 見出しのあとのコロンと、箇条書きの印(中国語は全角のコロン、日本語だけ中点)
const colon = () => (/^zh/.test(LANG) ? '：' : /^fr/.test(LANG) ? '\u00a0: ' : ': ');
// 数値と単位の間(フランス語は改行しない空白)
const usp = () => (/^fr/.test(LANG) ? '\u00a0' : ' ');
const bullet = () => (/^ja/.test(LANG) ? '・' : '• ');
export const setLang = l => { LANG = l; };
const nf = o => new Intl.NumberFormat(LANG, { useGrouping: false, ...o });
const minus = t => (/^-0(?:[.,]0*)?$/.test(t) ? t.slice(1) : t.replace(/^-/, '−'));
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
// 小数 d 桁
export const fd = (x, d) => minus(nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(x));
// 指数表記(有効数字 s 桁): 2.30 × 10⁻⁵
export const fsci = (x, s = 3) => {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const [m, e] = x.toExponential(s - 1).split('e');
  const mm = minus(nf({ minimumFractionDigits: s - 1, maximumFractionDigits: s - 1 }).format(Number(m)));
  return Number(e) === 0 ? mm : `${mm} × 10${String(Number(e)).replace(/./g, c => SUP[c])}`;
};
// 有効数字 s 桁(とても大きい・小さい値は指数表記)
export const fs = (x, s = 4) => {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e5 || a < 1e-3) return fsci(x, s);
  return minus(nf({ minimumSignificantDigits: s, maximumSignificantDigits: s }).format(x));
};
const f4 = x => fs(x, 4);
const dpOf = s => { const t = String(s); return t.includes('e-') ? Number(t.split('e-')[1]) : (t.split('.')[1]?.length ?? 0); };
const rnd = (x, d) => Number(x.toFixed(d));
const sig = (x, s) => Number(x.toPrecision(s));
// 文献の値をその桁のまま(小数1桁以上。100 以上の整数はそのまま)
const fv = x => (Number.isInteger(x) && x >= 100 ? String(x) : fd(x, Math.max(1, dpOf(x))));
// 問題文の数(整数はそのまま、小数は持っている桁で。言語の小数点と − を使う)
const fn = x => (Number.isInteger(x) ? minus(String(x)) : fd(x, dpOf(x)));
// 許容差の % の表示(0.01 → 1、0.005 → 0.5)
export const tolPct = tol => fs(tol * 100, 2).replace(/0+$/, '').replace(/[.,]$/, '');

// ---- 種つきの乱数(mulberry32)。型の名前も混ぜて、型ごとに別の列にする ----
export function makeRng(seed, id) {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let a = h;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    f: next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    // lo〜hi を s 刻みで(表示の桁にそろえた値)
    step: (lo, hi, s) => { const n = Math.round((hi - lo) / s); return rnd(lo + Math.floor(next() * (n + 1)) * s, dpOf(s)); },
    // lo〜hi(log なら対数で一様)を有効数字 n 桁で
    sig: (lo, hi, n, log) => sig(log ? Math.exp(Math.log(lo) + next() * (Math.log(hi) - Math.log(lo))) : lo + next() * (hi - lo), n),
  };
  // data/drill.json の範囲 v: [下限, 上限, 刻み] か { sig: 有効数字, lin|log: [下限, 上限] }
  r.v = spec => (Array.isArray(spec) ? r.step(...spec) : r.sig(...(spec.log ?? spec.lin), spec.sig, !!spec.log));
  return r;
}
// 範囲の書き方で表示する
export const showSpec = (x, spec) => (Array.isArray(spec) ? fd(x, dpOf(spec[2])) : fs(x, spec.sig));


// ---- 単位(家族ごとに、基準の単位に対する倍率。温度は [倍率, ずれ]) ----
export const UNITS = {
  conc: { 'mol/L': 1, 'mmol/L': 1e-3, 'µmol/L': 1e-6, 'nmol/L': 1e-9 },
  mconc: { 'g/L': 1, 'mg/L': 1e-3, 'µg/L': 1e-6 },
  pot: { V: 1, mV: 1e-3 },
  emol: { 'kJ/mol': 1, 'J/mol': 1e-3 },
  molar: { 'g/mol': 1, 'kg/mol': 1e3 },
  mass: { 'µg': 1e-6, mg: 1e-3, g: 1, kg: 1e3 },
  len: { pm: 1e-12, 'Å': 1e-10, nm: 1e-9, 'µm': 1e-6, mm: 1e-3, cm: 1e-2, m: 1 },
  ang: { '°': 1, rad: 180 / Math.PI },
  freq: { Hz: 1, kHz: 1e3, MHz: 1e6 },
  time: { ms: 1e-3, s: 1, min: 60, h: 3600 },
  inv: { 'cm⁻¹': 1, 'm⁻¹': 0.01 },
  rate: { 's⁻¹': 1, 'min⁻¹': 1 / 60, 'h⁻¹': 1 / 3600 },
  ppm: { ppm: 1 },
  frac: { '': 1, '%': 0.01 },
  num: { '': 1 },
  temp: { K: [1, -273.15], '°C': [1, 0] },
};
// 単位の書き方の揺れ(入力欄に単位まで書いたとき)。小文字にし、空白・中点・^ を除いてから引く
const nUnit = s => s.normalize('NFKC').replace(/[\s·⋅*.^]/g, '').replace(/[−–]/g, '-').replace(/[µμ]/g, 'u').replace(/Ω/g, 'ohm').replace(/[Å]/g, 'A').toLowerCase();
const ALIAS = {
  conc: { m: 'mol/L', mm: 'mmol/L', um: 'µmol/L', nm: 'nmol/L', 'mol/dm3': 'mol/L', 'moll-1': 'mol/L', 'mmol/dm3': 'mmol/L' },
  mconc: { ppm: 'mg/L', ppb: 'µg/L' },
  pot: { volt: 'V', volts: 'V', millivolt: 'mV' },
  emol: { kj: 'kJ/mol', 'kjmol-1': 'kJ/mol', j: 'J/mol', 'jmol-1': 'J/mol' },
  molar: { da: 'g/mol', kda: 'kg/mol', 'gmol-1': 'g/mol' },
  len: { um: 'µm', 'μm': 'µm', angstrom: 'Å', micron: 'µm' },
  ang: { deg: '°', '度': '°', degree: '°', degrees: '°' },
  time: { sec: 's', '秒': 's', '分': 'min', minute: 'min', minutes: 'min', hr: 'h', hour: 'h', hours: 'h', '時間': 'h' },
  rate: { '/s': 's⁻¹', '1/s': 's⁻¹', '/min': 'min⁻¹', '1/min': 'min⁻¹', '/h': 'h⁻¹', '1/h': 'h⁻¹' },
  inv: { '/cm': 'cm⁻¹', '1/cm': 'cm⁻¹', '/m': 'm⁻¹', '1/m': 'm⁻¹', kayser: 'cm⁻¹' },
  frac: { percent: '%' },
  temp: { c: '°C', degc: '°C', '°c': '°C', '度': '°C', kelvin: 'K' },
};
export function unitOf(fam, s) {
  const k = nUnit(s);
  if (!k) return null;
  for (const u of Object.keys(UNITS[fam])) if (nUnit(u) === k) return u;
  return ALIAS[fam]?.[k] ?? null;
}
// 値 x(単位 u)を、単位 to での値に
export function convert(fam, x, u, to) {
  const F = UNITS[fam];
  if (fam === 'temp') return (x * F[u][0] + F[u][1] - F[to][1]) / F[to][0];
  return x * F[u] / F[to];
}

// ---- 入力の読み取り: 「2.3e-5」「2,3 × 10^-5」「2.3×10⁻⁵ m²/s」など。単位が書いてあればその単位も返す ----
export function parseAnswer(raw, fam, lang = LANG) {
  let s = String(raw ?? '').normalize('NFKC').trim().replace(/[−–—]/g, '-').replace(/\s+/g, ' ');
  if (!s) return null;
  const m = s.match(/^([+-]?(?:\d[\d.,]*|[.,]\d+))\s*(?:[eE]\s*([+-]?\d+)|[×xX*]\s*10\s*(?:\^|\*\*)?\s*\(?\s*([+-]?\d+)\s*\)?)?\s*(.*)$/);
  if (!m) return null;
  let t = m[1];
  if (/^(de|es|pt|fr|nl)/.test(lang)) t = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  // 桁区切り(1,234)は頭が 0 でないときだけ。0,250 は小数のコンマとして読む
  else if (/^[+-]?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  if ((t.match(/\./g) ?? []).length > 1) return null;
  const v = Number(t) * 10 ** Number(m[2] ?? m[3] ?? 0);
  if (!Number.isFinite(v)) return null;
  const rest = m[4].trim();
  if (!rest) return { v, u: null };
  const u = unitOf(fam, rest);
  return u == null ? { v, u: null, bad: rest } : { v, u };
}

// ---- 補助 ----
const D2R = Math.PI / 180;
const sind = d => Math.sin(d * D2R), cosd = d => Math.cos(d * D2R);
const asind = x => Math.asin(x) / D2R;
const lg = Math.log10, ln = Math.log;
const K0 = 273.15;
// よくある間違いの値が正解から十分に離れているときだけ挙げる(t: 型の許容差)。
// judge は正解を ±t、間違いの値を ±max(t, 0.5 %) で見るので、その2つの幅が重ならないこと
const far = (a, ans, t = 0.01) => Number.isFinite(a) && Math.abs(a - ans) > t * Math.abs(ans) + Math.max(t, 0.005) * Math.abs(a);
// 足す項を符号つきで(+ 0.2293 / − 0.2293)。「+ (−0.2293)」や「+ (0.2293)」と書かない
const pm = x => (x < 0 ? `− ${f4(-x)}` : `+ ${f4(x)}`);
const opt = (cond, o) => (cond ? o : {});
const nm = (X, k, id) => X.N.x[`${k}_${id}`] ?? id;
// 化学式の下つき数字(1 は書かない)
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = n => (n === 1 ? '' : String(n).replace(/\d/g, d => SUB[d]));
// 正規分布の乱数(Box–Muller)
const gauss = r => Math.sqrt(-2 * Math.log(1 - r.f())) * Math.cos(2 * Math.PI * r.f());
const sum = a => a.reduce((s, x) => s + x, 0);
// 同位体の存在比を入れかえた・丸めたパターン(よくある間違いの値)
const pattern = (ncl, nbr, cl, br) => {
  let p = [1];
  for (const [a, b] of [...Array(ncl).fill(cl), ...Array(nbr).fill(br)]) {
    const q = Array(p.length + 1).fill(0);
    p.forEach((v, i) => { q[i] += v * a; q[i + 1] += v * b; });
    p = q;
  }
  return p;
};

// ---- 問題の型 ----
// gen(r, T, X): 問題の数値(vals)。T は data/drill.json の型(v: 範囲、pick: 選ぶもの)、X は { D: データ、N: 名前 }
// show(vals, T, X): 問題文に入れる文字(自動で、範囲 v のある値は範囲の桁で入る)
// solve(vals, X): { ans, fam, unit, k: 途中式の文字, alt: { 間違いのID: そのときの値(unit で) }, tool: { id, q }, dec: 整数の答えの桁 }
// vals.v があれば、文章(q・steps)の場合分けの鍵になる
export const TYPES = {
  // ===== 酸塩基・滴定・溶解度 =====
  'weak-acid': {
    gen: (r, T, X) => {
      const q = r.pick(['ph', 'alpha', 'pka']);
      for (;;) {
        const acid = r.pick(T.pick.acid), pKa = X.D.pka[acid], Ka = 10 ** -pKa, C = r.v(T.v.C);
        // 電離度が 5 % 以下(C ≥ 400 Ka)で、水の電離が効かない(KaC ≥ 10⁻¹¹)ときだけ [H⁺] ≈ √(KaC) の近似を使う
        if (C < 400 * Ka || Ka * C < 1e-11) continue;
        if (q === 'pka') return { v: q, acid, C, pH: rnd(-lg(Math.sqrt(Ka * C)), 2) };
        return { v: q, acid, pKa, C };
      }
    },
    show: (v, T, X) => ({ acid: nm(X, 'acid', v.acid), C: fs(v.C, 2), ...(v.pKa != null ? { pKa: fd(v.pKa, 2) } : { pH: fd(v.pH, 2) }) }),
    solve: v => {
      if (v.v === 'pka') {
        const lc = lg(v.C), pKa = 2 * v.pH + lc;
        return { ans: pKa, fam: 'num', unit: '', k: { lc: f4(lc), lcp: pm(lc), h: fsci(10 ** -v.pH, 3), h2: fsci(10 ** (-2 * v.pH), 3), Ka: fsci(10 ** -pKa, 3), pKa: f4(pKa) },
          alt: { ...opt(far(2 * v.pH - lc, pKa, 0.005), { sign: 2 * v.pH - lc }), ...opt(far(v.pH, pKa, 0.005), { ph: v.pH }), ...opt(far(v.pH + lc, pKa, 0.005), { no2: v.pH + lc }) } };
      }
      const Ka = 10 ** -v.pKa, h = Math.sqrt(Ka * v.C), pH = -lg(h), a = h / v.C;
      const k = { Ka: fsci(Ka, 3), KC: fsci(Ka * v.C, 3), h: fsci(h, 3), pH: f4(pH), a: f4(a * 100) };
      if (v.v === 'ph') {
        return { ans: pH, fam: 'num', unit: '', k,
          alt: { ...opt(far(-lg(Ka * v.C), pH, 0.005), { nosqrt: -lg(Ka * v.C) }), ...opt(far(v.pKa, pH, 0.005), { pka: v.pKa }), ...opt(far(v.pKa / 2, pH, 0.005), { noc: v.pKa / 2 }) } };
      }
      return { ans: a * 100, fam: 'frac', unit: '%', k, alt: { ...opt(far(Ka / v.C * 100, a * 100), { nosqrt: Ka / v.C * 100 }), ...opt(far(h * 100, a * 100), { h: h * 100 }) } };
    },
  },
  'buffer-ph': {
    gen: (r, T, X) => {
      const acid = r.pick(T.pick.acid), pKa = X.D.pka[acid], q = r.pick(['ph', 'ratio', 'mix']);
      if (q === 'ph') {
        for (;;) { const ha = r.v(T.v.c), a = r.v(T.v.c); if (a !== ha && a / ha >= 0.1 && a / ha <= 10) return { v: q, acid, pKa, ha, a }; }
      }
      for (;;) {
        const d = r.step(-1, 1, 0.05);
        if (Math.abs(d) < 0.1) continue;
        const pH = rnd(pKa + d, 2);
        return q === 'ratio' ? { v: q, acid, pKa, pH } : { v: q, acid, pKa, pH, tot: r.v(T.v.tot) };
      }
    },
    show: (v, T, X) => ({ han: nm(X, 'ha', v.acid), an: nm(X, 'a', v.acid), pKa: fd(v.pKa, 2), ...(v.v === 'ph' ? { ha: fs(v.ha, 2), a: fs(v.a, 2) } : { pH: fd(v.pH, 2) }), ...(v.tot != null ? { tot: fs(v.tot, 2) } : {}) }),
    solve: v => {
      if (v.v === 'ph') {
        const rr = v.a / v.ha, pH = bufferPH(v.pKa, v.ha, v.a);
        return { ans: pH, fam: 'num', unit: '', k: { r: f4(rr), lr: f4(lg(rr)), lrp: pm(lg(rr)), pH: f4(pH) },
          alt: { ...opt(far(v.pKa - lg(rr), pH, 0.005), { inv: v.pKa - lg(rr) }), ...opt(far(v.pKa + ln(rr), pH, 0.005), { ln: v.pKa + ln(rr) }) },
          tool: { id: 'buffer', q: { pka: v.pKa, ha: v.ha, a: v.a } } };
      }
      const m = bufferMix(v.pKa, v.pH, v.tot ?? 0.1), d = v.pH - v.pKa;
      const k = { d: fd(d, 2), ratio: f4(m.ratio), a: f4(m.a), ha: f4(m.ha), r1: f4(1 + m.ratio) };
      const tool = { id: 'buffer', q: { pka: v.pKa, target: v.pH, total: v.tot ?? 0.1 } };
      if (v.v === 'ratio') return { ans: m.ratio, fam: 'num', unit: '', k, alt: { ...opt(far(1 / m.ratio, m.ratio), { inv: 1 / m.ratio }), ...opt(far(Math.exp(d), m.ratio), { ln: Math.exp(d) }) }, tool };
      return { ans: m.a, fam: 'conc', unit: 'mol/L', k, alt: { ...opt(far(m.ha, m.a), { ha: m.ha }), ...opt(far(v.tot * m.ratio, m.a), { nosplit: v.tot * m.ratio }) }, tool };
    },
  },
  titration: {
    gen: (r, T) => {
      const q = r.pick(['mono', 'di', 'mno4']);
      if (q === 'mno4') return { v: q, m: r.v(T.v.mox), V: r.v(T.v.Vt) };
      return { v: q, ...(q === 'mono' ? { acid: r.pick(T.pick.mono) } : {}), Va: r.pick(T.pick.Va), cb: r.v(T.v.cb), V: r.v(T.v.Vt) };
    },
    show: (v, T, X) => ({ V: fd(v.V, 2), ...(v.v === 'mno4' ? { m: fd(v.m, 4), M: fd(X.D.mw.na2c2o4, 2) } : { Va: fd(v.Va, 2), cb: fd(v.cb, 4) }), ...(v.acid ? { acid: nm(X, 'acid', v.acid) } : {}) }),
    solve: (v, X) => {
      if (v.v === 'mno4') {
        const nox = v.m / X.D.mw.na2c2o4, nmn = 0.4 * nox, c = nmn / (v.V / 1000);
        return { ans: c, fam: 'conc', unit: 'mol/L', k: { nox: fsci(nox, 4), nmn: fsci(nmn, 4), c: f4(c) },
          alt: { inv25: 2.5 * nox / (v.V / 1000), one: nox / (v.V / 1000) } };
      }
      const n = v.cb * v.V / 1000, c = (v.v === 'di' ? n / 2 : n) / (v.Va / 1000);
      const k = { n: fsci(n, 4), na: fsci(v.v === 'di' ? n / 2 : n, 4), c: f4(c) };
      if (v.v === 'mono') return { ans: c, fam: 'conc', unit: 'mol/L', k, alt: { ...opt(far(v.cb * v.Va / v.V, c, 0.005), { inv: v.cb * v.Va / v.V }) } };
      return { ans: c, fam: 'conc', unit: 'mol/L', k, alt: { no2: 2 * c, x2: 4 * c } };
    },
  },
  ksp: {
    gen: (r, T, X) => {
      const salt = r.pick(T.pick.salt), [m, x, K] = X.D.ksp[salt];
      if (r.pick(['s', 'ksp']) === 's') return { v: 's', salt, m, x, K };
      const s0 = (K / (m ** m * x ** x)) ** (1 / (m + x));
      return { v: 'ksp', salt, m, x, s: sig(s0 * (0.7 + 0.6 * r.f()), 3) };
    },
    show: (v, T, X) => ({ salt: nm(X, 'salt', v.salt), eq: nm(X, 'eq', v.salt), ks: nm(X, 'ks', v.salt), ...(v.K != null ? { K: fsci(v.K, 2) } : { s: fsci(v.s, 3) }) }),
    solve: v => {
      const c = v.m ** v.m * v.x ** v.x, n = v.m + v.x;
      if (v.v === 's') {
        const s = (v.K / c) ** (1 / n);
        return { ans: s, fam: 'conc', unit: 'mol/L', k: { c: fn(c), n: fn(n), pw: n === 2 ? '²' : '³', Kc: fsci(v.K / c, 3), s: fsci(s, 3) },
          alt: { ...opt(far(v.K ** (1 / n), s), { nocoef: v.K ** (1 / n) }), ...opt(n > 2 && far(Math.sqrt(v.K), s), { sqrt: Math.sqrt(v.K) }) } };
      }
      const K = c * v.s ** n;
      return { ans: K, fam: 'num', unit: '', k: { c: fn(c), n: fn(n), pw: n === 2 ? '²' : '³', cx: `${fn(c)} × `, sn: fsci(v.s ** n, 3), K: fsci(K, 3) },
        alt: { ...opt(far(v.s ** n, K), { nocoef: v.s ** n }), ...opt(far(v.m * v.x * v.s ** n, K) && far(v.m * v.x * v.s ** n, v.s ** n), { lin: v.m * v.x * v.s ** n }) } };
    },
  },
  'common-ion': {
    gen: (r, T, X) => {
      for (;;) {
        const cs = r.pick(T.pick.cs), [salt] = cs.split('_'), [m, x, K] = X.D.ksp[salt], c = r.v(T.v.c);
        const s = { agcl_cl: K / c, baso4_so4: K / c, ag2cro4_cro4: Math.sqrt(K / c) / 2, ag2cro4_ag: K / c ** 2, caf2_f: K / c ** 2 }[cs];
        // 共通イオンの濃度を c のままとみなせる(厳密な解との差が 0.5 % 以下)ときだけ
        if ({ agcl_cl: s / c, baso4_so4: s / c, ag2cro4_cro4: s / (2 * c), ag2cro4_ag: 4 * s / c, caf2_f: 4 * s / c }[cs] > 0.005) continue;
        return { v: cs, salt, m, x, K, c };
      }
    },
    show: (v, T, X) => ({ salt: nm(X, 'salt', v.salt), K: fsci(v.K, 2), c: fs(v.c, 2) }),
    solve: v => {
      const K = v.K, c = v.c, s0 = (K / (v.m ** v.m * v.x ** v.x)) ** (1 / (v.m + v.x));
      const s = { agcl_cl: K / c, baso4_so4: K / c, ag2cro4_cro4: Math.sqrt(K / c) / 2, ag2cro4_ag: K / c ** 2, caf2_f: K / c ** 2 }[v.v];
      const alt = { ...opt(far(s0, s), { pure: s0 }) };
      if (v.v === 'ag2cro4_cro4') Object.assign(alt, opt(far(Math.sqrt(K / c), s), { noh: Math.sqrt(K / c) }), opt(far(K / c, s), { nosq: K / c }));
      if (v.v === 'ag2cro4_ag' || v.v === 'caf2_f') Object.assign(alt, opt(far(K / c, s), { nosq: K / c }));
      return { ans: s, fam: 'conc', unit: 'mol/L', k: { Kc: fsci(K / c, 3), c2: fsci(c * c, 3), s: fsci(s, 3), s0: fsci(s0, 3) }, alt };
    },
  },
  // ===== 電気化学 =====
  nernst: {
    gen: (r, T, X) => {
      const q = r.pick(['she', 'ref']);
      for (;;) {
        const el = r.pick(T.pick.el), [E0, n] = X.D.e0[el], S = X.D.c.s25;
        let o, E;
        if (el === 'fe') {
          const c3 = r.v(T.v.cf), c2 = r.v(T.v.cf);
          if (c2 === c3) continue;
          o = { c3, c2 };
          E = E0 - S * lg(c2 / c3);
        } else {
          const a = r.v(T.v.a);
          o = { a };
          E = E0 - S / n * lg(1 / a);
        }
        const Ea = q === 'ref' ? E - X.D.c.ref : E;
        if (Math.abs(Ea) < 0.1) continue;
        return { v: el === 'fe' ? `${q}-fe` : q, el, E0, n, ...o };
      }
    },
    show: (v, T, X) => ({ hr: nm(X, 'hr', v.el), E0: fd(v.E0, 3), n: fn(v.n), ref: fd(X.D.c.ref, 3), S: fd(X.D.c.s25, 5),
      ...(v.a != null ? { a: fsci(v.a, 2), ion: nm(X, 'ion', v.el) } : { c3: fs(v.c3, 2), c2: fs(v.c2, 2) }) }),
    solve: (v, X) => {
      const S = X.D.c.s25, ref = /^ref/.test(v.v), off = ref ? X.D.c.ref : 0;
      const lq = v.a != null ? lg(1 / v.a) : lg(v.c2 / v.c3), Q = v.a != null ? 1 / v.a : v.c2 / v.c3;
      const E = v.E0 - S / v.n * lq, ans = E - off;
      const alt = {
        ...opt(v.n > 1 && far(v.E0 - S * lq - off, ans), { non: v.E0 - S * lq - off }),
        ...opt(far(v.E0 + S / v.n * lq - off, ans), { inv: v.E0 + S / v.n * lq - off }),
        ...opt(far(v.E0 - S / v.n * ln(Q) - off, ans), { ln: v.E0 - S / v.n * ln(Q) - off }),
        ...opt(ref && far(E, ans), { noref: E }),
        ...opt(ref && far(E + off, ans), { refsign: E + off }),
      };
      return { ans, fam: 'pot', unit: 'V', k: { Q: fsci(Q, 3), lq: f4(lq), t: f4(S / v.n * lq), E: f4(E), Er: f4(E - X.D.c.ref) }, alt };
    },
  },
  'nernst-slope': {
    gen: (r, T, X) => {
      const t = r.v(T.v.t);
      if (r.pick(['slope', 'ph']) === 'slope') return { v: 'slope', t, z: r.pick([1, 2]) };
      for (;;) {
        const pHs = r.pick(T.pick.pHs), pHx = r.step(1.5, 12.5, 0.01);
        if (Math.abs(pHx - pHs) < 0.5) continue;
        // 標準液の電位は、pH 7 で 0 mV 付近(不斉電位 ±30 mV)のガラス電極としての値
        const S = Math.LN10 * X.D.c.R * (t + K0) / X.D.c.F * 1000, Es = rnd(S * (7 - pHs) + r.step(-30, 30, 0.1), 1);
        return { v: 'ph', t, pHs, Es, Ex: rnd(Es - S * (pHx - pHs), 1) };
      }
    },
    show: v => ({ t: fn(v.t), ...(v.z != null ? { z: fn(v.z) } : { pHs: fd(v.pHs, 2), Es: fd(v.Es, 1), Ex: fd(v.Ex, 1) }) }),
    solve: (v, X) => {
      const { R, F } = X.D.c, Tk = v.t + K0, S1 = Math.LN10 * R * Tk / F * 1000;
      if (v.v === 'slope') {
        const S = S1 / v.z;
        return { ans: S, fam: 'pot', unit: 'mV', k: { T: fd(Tk, 2), S: f4(S), S1: f4(S1) },
          alt: { ln: S / Math.LN10, ...opt(far(Math.LN10 * R * v.t / (v.z * F) * 1000, S), { c: Math.LN10 * R * v.t / (v.z * F) * 1000 }), ...opt(v.z > 1, { noz: S1 }) } };
      }
      const dE = v.Es - v.Ex, pH = v.pHs + dE / S1;
      return { ans: pH, fam: 'num', unit: '', k: { T: fd(Tk, 2), S: f4(S1), dE: dE < 0 ? `(${fd(dE, 1)})` : fd(dE, 1), dp: f4(dE / S1), dpp: pm(dE / S1), pH: f4(pH) },
        alt: { ...opt(far(v.pHs - dE / S1, pH, 0.005), { sign: v.pHs - dE / S1 }), ...opt(far(v.pHs + dE / (S1 / Math.LN10), pH, 0.005), { ln: v.pHs + dE / (S1 / Math.LN10) }),
          ...opt(far(v.pHs + dE / 59.16, pH, 0.005), { s25: v.pHs + dE / 59.16 }) } };
    },
  },
  faraday: {
    gen: (r, T) => {
      const q = r.pick(['m', 't']), metal = r.pick(T.pick.metal), I = r.v(T.v.I);
      return q === 'm' ? { v: q, metal, I, t: r.v(T.v.t) } : { v: q, metal, I, mt: r.v(T.v.mt) };
    },
    show: (v, T, X) => ({ metal: nm(X, 'metal', v.metal), M: fd(X.D.metal[v.metal][0], 2), z: fn(X.D.metal[v.metal][1]), I: fn(v.I), F: fn(X.D.c.F), ...(v.t != null ? { t: fn(v.t) } : { mt: fd(v.mt, 1) }) }),
    solve: (v, X) => {
      const [M, z] = X.D.metal[v.metal], F = X.D.c.F, I = v.I / 1000;
      if (v.v === 'm') {
        const Q = I * v.t * 60, ne = Q / F, m = ne / z * M * 1000;
        return { ans: m, fam: 'mass', unit: 'mg', k: { ts: fn(v.t * 60), Q: f4(Q), ne: fsci(ne, 4), nm: fsci(ne / z, 4), m: f4(m) },
          alt: { ...opt(z > 1, { noz: m * z }), min: m / 60 } };
      }
      const nmet = v.mt / 1000 / M, ne = nmet * z, Q = ne * F, ts = Q / I;
      return { ans: ts / 60, fam: 'time', unit: 'min', k: { nm: fsci(nmet, 4), ne: fsci(ne, 4), Q: f4(Q), ts: f4(ts), tm: f4(ts / 60) },
        alt: { ...opt(z > 1, { noz: ts / z / 60 }) } };
    },
  },
  'dg-e': {
    gen: (r, T, X) => {
      const q = r.pick(['dg', 'logk', 'e']), n = r.pick(T.pick.n);
      // E° が水溶液の電池でありうる範囲(|E°| ≤ 2.5 V)に入るものだけ(n = 1 で ΔG° = −500 kJ/mol だと 5.2 V になる)
      if (q === 'e') { for (;;) { const dG = r.step(-500, 200, 0.1); if (Math.abs(dG) >= 5 && Math.abs(dG * 1000 / (n * X.D.c.F)) <= 2.5) return { v: q, n, dG }; } }
      for (;;) { const E = r.step(-0.8, 1.6, 0.001); if (Math.abs(E) >= 0.05) return { v: q, n, E }; }
    },
    show: (v, T, X) => ({ n: fn(v.n), F: fn(X.D.c.F), S: fd(X.D.c.s25, 5), ...(v.E != null ? { E: fd(v.E, 3) } : { dG: fd(v.dG, 1) }) }),
    solve: (v, X) => {
      const { F, R, s25 } = X.D.c;
      if (v.v === 'dg') {
        const dG = -v.n * F * v.E / 1000;
        return { ans: dG, fam: 'emol', unit: 'kJ/mol', k: { J: fn(Math.round(-v.n * F * v.E)), dG: f4(dG) }, alt: { ...opt(v.n > 1, { non: dG / v.n }) } };
      }
      if (v.v === 'logk') {
        const lk = v.n * v.E / s25, lnk = v.n * F * v.E / (R * 298.15);
        return { ans: lk, fam: 'num', unit: '', k: { lk: f4(lk), K: fsci(10 ** lk, 3) }, alt: { ln: lnk, ...opt(v.n > 1, { non: lk / v.n }) } };
      }
      const E = -v.dG * 1000 / (v.n * F);
      return { ans: E, fam: 'pot', unit: 'V', k: { J: fd(v.dG * 1000, 0), nF: fn(v.n * F), E: f4(E) }, alt: { ...opt(v.n > 1, { non: E * v.n }) } };
    },
  },
  // ===== 分光 =====
  'beer-conc': {
    gen: (r, T) => {
      const q = r.pick(['a', 't']), sp = r.pick(['nadh', 'x']), l = r.pick(T.pick.l);
      const eps = sp === 'nadh' ? 6220 : r.v(T.v.eps);
      return q === 'a' ? { v: q, sp, eps, l, A: r.v(T.v.A) } : { v: q, sp, eps, l, Tp: r.v(T.v.Tp) };
    },
    show: (v, T, X) => ({ sp: nm(X, 'sp', v.sp), eps: fn(v.eps), l: fd(v.l, 1), ...(v.A != null ? { A: fd(v.A, 3) } : { Tp: fd(v.Tp, 1) }) }),
    solve: v => {
      const A = v.A ?? absFromT(v.Tp), el = v.eps * v.l, c = beerConc(A, v.eps, v.l);
      const k = { A: f4(A), el: fn(rnd(el, 3)), c: fsci(c, 4), cu: f4(c * 1e6) };
      const alt = { mult: A * el * 1e6, mm: c / 10 * 1e6 };
      if (v.v === 't') Object.assign(alt, opt(far(-ln(v.Tp / 100) / el * 1e6, c * 1e6), { ln: -ln(v.Tp / 100) / el * 1e6 }), { tasa: v.Tp / el * 1e6 });
      return { ans: c * 1e6, fam: 'conc', unit: 'µmol/L', k, alt, tool: { id: 'beer', q: { abs: rnd(A, 4), eps: v.eps, l: v.l } } };
    },
  },
  absorbance: {
    gen: (r, T) => (r.pick(['t', 'a']) === 't' ? { v: 't', A: r.v(T.v.A) } : { v: 'a', Tp: r.v(T.v.Tp) }),
    solve: v => {
      if (v.v === 't') {
        const Tp = 100 * 10 ** -v.A;
        return { ans: Tp, fam: 'frac', unit: '%', k: { Tf: f4(Tp / 100), Tp: f4(Tp) },
          alt: { ln: 100 * Math.exp(-v.A), ...opt(v.A < 0.95 && far(100 * (1 - v.A), Tp), { lin: 100 * (1 - v.A) }) }, tool: { id: 'beer', q: { abs: v.A } } };
      }
      const A = absFromT(v.Tp);
      return { ans: A, fam: 'num', unit: '', k: { Tf: f4(v.Tp / 100), A: f4(A) },
        alt: { ln: -ln(v.Tp / 100), nopct: -lg(v.Tp) }, tool: { id: 'beer', q: { abs: rnd(A, 4) } } };
    },
  },
  wavenumber: {
    gen: (r, T) => {
      const q = r.pick(['lam', 'nu', 'e']);
      return q === 'nu' ? { v: q, lam: r.v(T.v.lam) } : { v: q, nu: r.v(T.v.nu) };
    },
    show: (v, T, X) => ({ ...(v.nu != null ? { nu: fn(v.nu) } : { lam: fn(v.lam) }), h: fsci(X.D.c.h, 9), c: fn(X.D.c.c), NA: fsci(X.D.c.NA, 9) }),
    solve: (v, X) => {
      if (v.v === 'lam') { const l = 1e4 / v.nu; return { ans: l, fam: 'len', unit: 'µm', k: { cm: fsci(1 / v.nu, 4), l: f4(l) }, alt: {} }; }
      if (v.v === 'nu') { const n = 1e7 / v.lam; return { ans: n, fam: 'inv', unit: 'cm⁻¹', k: { cm: fsci(v.lam * 1e-7, 3), n: f4(n) }, alt: {} }; }
      const { h, c, NA } = X.D.c, E1 = h * c * v.nu * 100, E = E1 * NA / 1000;
      return { ans: E, fam: 'emol', unit: 'kJ/mol', k: { m: fsci(v.nu * 100, 4), E1: fsci(E1, 4), E: f4(E) }, alt: { nona: E1 / 1000 } };
    },
  },
  // ===== NMR と質量分析 =====
  'nmr-shift': {
    gen: (r, T) => {
      const q = r.pick(['ppm', 'hz', 'b0']);
      if (q === 'b0') return { v: q, B0: r.pick(T.pick.B0) };
      const nu0 = r.pick(T.pick.nu0), d = r.step(0.5, 11, 0.01);
      return q === 'ppm' ? { v: q, nu0, dv: rnd(d * nu0, 1) } : { v: q, nu0, d };
    },
    show: (v, T, X) => ({ ...(v.nu0 != null ? { nu0: fn(v.nu0) } : { B0: fd(v.B0, 2), g: fd(X.D.c.gH, 3) }), ...(v.dv != null ? { dv: fd(v.dv, 1) } : {}), ...(v.d != null ? { d: fd(v.d, 2) } : {}) }),
    solve: (v, X) => {
      if (v.v === 'ppm') { const d = v.dv / v.nu0; return { ans: d, fam: 'ppm', unit: 'ppm', k: { d: f4(d) }, alt: { ...opt(far(v.nu0 / v.dv, d), { inv: v.nu0 / v.dv }) } }; }
      if (v.v === 'hz') { const dv = v.d * v.nu0; return { ans: dv, fam: 'freq', unit: 'Hz', k: { dv: f4(dv) }, alt: { ...opt(far(v.d / v.nu0, dv), { div: v.d / v.nu0 }) } }; }
      const g = X.D.c.gH, nu = g * v.B0;
      return { ans: nu, fam: 'freq', unit: 'MHz', k: { nu: f4(nu) }, alt: { pi2: nu * 2 * Math.PI, dpi: nu / (2 * Math.PI) } };
    },
  },
  dbe: {
    gen: r => {
      for (;;) {
        const c = r.int(2, 20), U = r.int(0, Math.min(10, c)), nN = r.pick([0, 0, 0, 1, 1, 2]), x = r.pick([0, 0, 0, 1, 2, 3]), o = r.int(0, 4);
        const h = 2 * c + 2 + nN - x - 2 * U;
        if (h < 1) continue;
        return { c, h, nN, o, x, hal: r.pick(['Cl', 'Br']) };
      }
    },
    show: v => ({ f: `C${sub(v.c)}H${sub(v.h)}${v.x ? `${v.hal}${sub(v.x)}` : ''}${v.nN ? `N${sub(v.nN)}` : ''}${v.o ? `O${sub(v.o)}` : ''}`, c: fn(v.c), h: fn(v.h), x: fn(v.x), nN: fn(v.nN), hal: v.hal }),
    solve: v => {
      const U = v.c - v.h / 2 - v.x / 2 + v.nN / 2 + 1;
      return { ans: U, fam: 'num', unit: '', dec: 0, k: { h2: fn(v.h / 2), x2: fn(v.x / 2), n2: fn(v.nN / 2), U: fn(U) },
        alt: { ...opt(v.o > 0, { o: U + v.o / 2 }), ...opt(v.x > 0, { x: U + v.x / 2 }), ...opt(v.nN > 0, { n: U - v.nN / 2, nsign: U - v.nN }) } };
    },
  },
  isotope: {
    gen: r => {
      const q = r.pick(['m2', 'm4', 'nc']);
      if (q === 'nc') { const n = r.int(3, 30); return { v: q, m1: sig(mPlus1(n), 3) }; }
      for (;;) {
        const ncl = r.int(0, 4), nbr = r.int(0, 3), s = ncl + nbr;
        if (s >= (q === 'm4' ? 2 : 1) && s <= 4) return { v: q, ncl, nbr };
      }
    },
    show: (v, T, X) => (v.v === 'nc' ? { m1: fs(v.m1, 3) } : {
      who: fillText(X.N.x[v.ncl && v.nbr ? 'iso_both' : v.ncl ? 'iso_cl' : 'iso_br'], { ncl: fn(v.ncl), nbr: fn(v.nbr) }),
      ncl: fn(v.ncl), nbr: fn(v.nbr), cl: fd(CL[0] * 100, 2), cl2: fd(CL[1] * 100, 2), br: fd(BR[0] * 100, 2), br2: fd(BR[1] * 100, 2) }),
    solve: v => {
      if (v.v === 'nc') {
        const n = v.m1 * 98.93 / 107;
        return { ans: n, fam: 'num', unit: '', k: { n: f4(n), ni: fn(Math.round(n)) }, alt: {}, tool: { id: 'isotope', q: { ncl: 0, nbr: 0, nc: Math.round(n) } } };
      }
      const i = v.v === 'm2' ? 1 : 2, p = isotopePattern(v.ncl, v.nbr), ans = p[i] / p[0] * 100;
      const sw = pattern(v.ncl, v.nbr, BR, CL), ap = pattern(v.ncl, v.nbr, [0.75, 0.25], [0.5, 0.5]);
      const rc = CL[1] / CL[0], rb = BR[1] / BR[0];
      const k = { rc: f4(rc), rb: f4(rb), a: f4(ans), cc: fn(v.ncl * (v.ncl - 1) / 2), bb: fn(v.nbr * (v.nbr - 1) / 2), cb: fn(v.ncl * v.nbr) };
      const alt = { ...opt(far(sw[i] / sw[0] * 100, ans), { swap: sw[i] / sw[0] * 100 }), ...opt(far(ap[i] / ap[0] * 100, ans), { approx: ap[i] / ap[0] * 100 }) };
      if (i === 2 && (!v.ncl || !v.nbr)) { const nb = (v.ncl ? rc : rb) ** 2 * 100; Object.assign(alt, opt(far(nb, ans), { nobin: nb })); }
      return { ans, fam: 'frac', unit: '%', k, alt, tool: { id: 'isotope', q: { ncl: v.ncl, nbr: v.nbr } } };
    },
  },
  'mass-error': {
    gen: (r, T, X) => {
      const cmp = r.pick(T.pick.cmp), ion = r.pick(['h', 'na']), M = X.D.mono[cmp], mi = M + X.D.c[ion === 'h' ? 'mp' : 'mna'];
      for (;;) {
        const e = (1.5 + 6.5 * r.f()) * (r.f() < 0.5 ? -1 : 1), meas = rnd(mi * (1 + e * 1e-6), 4);
        if (Math.abs((meas - mi) / mi * 1e6) >= 1.5) return { v: ion, cmp, M, meas };
      }
    },
    show: (v, T, X) => ({ cmp: nm(X, 'cmp', v.cmp), M: fd(v.M, 6), meas: fd(v.meas, 4), mi: fd(X.D.c[v.v === 'h' ? 'mp' : 'mna'], 6) }),
    solve: (v, X) => {
      const C = X.D.c, calc = v.M + (v.v === 'h' ? C.mp : C.mna), e = (v.meas - calc) / calc * 1e6;
      const ca = v.M + (v.v === 'h' ? C.mh : C.mnaa), ea = (v.meas - ca) / ca * 1e6;
      return { ans: e, fam: 'ppm', unit: 'ppm', k: { calc: fd(calc, 6), d: fd((v.meas - calc) * 1000, 2), e: f4(e) },
        alt: { ...opt(far(ea, e), { atom: ea }), neutral: (v.meas - v.M) / v.M * 1e6 } };
    },
  },
  // ===== クロマトグラフィー =====
  retention: {
    gen: (r, T) => {
      const t0 = r.v(T.v.t0);
      if (r.pick(['k', 'alpha']) === 'k') return { v: 'k', t0, tr: rnd(t0 * (1 + r.sig(0.5, 15, 2)), 2) };
      const k1 = r.sig(1, 10, 2), a = r.step(1.03, 1.5, 0.01);
      return { v: 'alpha', t0, tr1: rnd(t0 * (1 + k1), 2), tr2: rnd(t0 * (1 + k1 * a), 2) };
    },
    show: v => ({ t0: fd(v.t0, 2), ...(v.tr != null ? { tr: fd(v.tr, 2) } : { tr1: fd(v.tr1, 2), tr2: fd(v.tr2, 2) }) }),
    solve: v => {
      if (v.v === 'k') {
        const k = retentionFactor(v.tr, v.t0);
        return { ans: k, fam: 'num', unit: '', k: { d: fd(v.tr - v.t0, 2), k: f4(k) },
          alt: { ratio: v.tr / v.t0, ...opt(far(v.tr - v.t0, k), { nodiv: v.tr - v.t0 }), ...opt(far(v.t0 / (v.tr - v.t0), k), { inv: v.t0 / (v.tr - v.t0) }) }, tool: { id: 'chrom', q: { t0: v.t0, tr1: v.tr } } };
      }
      const k1 = retentionFactor(v.tr1, v.t0), k2 = retentionFactor(v.tr2, v.t0), a = k2 / k1;
      return { ans: a, fam: 'num', unit: '', k: { k1: f4(k1), k2: f4(k2), a: f4(a) },
        alt: { ...opt(far(v.tr2 / v.tr1, a, 0.005), { tr: v.tr2 / v.tr1 }), ainv: k1 / k2 }, tool: { id: 'chrom', q: { t0: v.t0, tr1: v.tr1, tr2: v.tr2 } } };
    },
  },
  resolution: {
    gen: (r, T) => {
      const q = r.pick(['base', 'half']);
      for (;;) {
        const t1 = r.v(T.v.t1), dt = r.v(T.v.dt), t2 = rnd(t1 + dt, 2), w1 = r.v(q === 'base' ? T.v.w : T.v.wh), w2 = rnd(w1 * t2 / t1, 2);
        const rs = (q === 'base' ? 2 : 1.18) * dt / (w1 + w2);
        if (rs < 0.4 || rs > 4) continue;
        return { v: q, t1, t2, w1, w2 };
      }
    },
    show: v => ({ t1: fd(v.t1, 2), t2: fd(v.t2, 2), w1: fd(v.w1, 2), w2: fd(v.w2, 2) }),
    solve: v => {
      const dt = v.t2 - v.t1, ws = v.w1 + v.w2, k = { dt: fd(dt, 2), ws: fd(ws, 2) };
      if (v.v === 'base') {
        const rs = resolution(v.t1, v.t2, v.w1, v.w2);
        return { ans: rs, fam: 'num', unit: '', k: { ...k, rs: f4(rs) }, alt: { no2: rs / 2, h118: 1.18 * dt / ws }, tool: { id: 'chrom', q: { tr1: v.t1, tr2: v.t2, w1: v.w1, w2: v.w2 } } };
      }
      const rs = 1.18 * dt / ws;
      return { ans: rs, fam: 'num', unit: '', k: { ...k, rs: f4(rs) }, alt: { two: 2 * dt / ws, no: dt / ws } };
    },
  },
  plates: {
    gen: (r, T) => {
      const q = r.pick(['base', 'half', 'h']), tr = r.v(T.v.tr), N = r.v(T.v.N);
      if (q === 'half') return { v: q, tr, wh: sig(2.355 * tr / Math.sqrt(N), 3) };
      return { v: q, tr, w: sig(4 * tr / Math.sqrt(N), 3), ...(q === 'h' ? { L: r.pick(T.pick.L) } : {}) };
    },
    show: v => ({ tr: fd(v.tr, 2), ...(v.w != null ? { w: fs(v.w, 3) } : { wh: fs(v.wh, 3) }), ...(v.L != null ? { L: fn(v.L) } : {}) }),
    solve: v => {
      if (v.v === 'half') {
        const x = v.tr / v.wh, N = platesHalf(v.tr, v.wh);
        return { ans: N, fam: 'num', unit: '', k: { x: f4(x), x2: f4(x * x), N: f4(N) }, alt: { base: 16 * x * x, nosq: 5.54 * x } };
      }
      const x = v.tr / v.w, N = plates(v.tr, v.w), k = { x: f4(x), x2: f4(x * x), N: f4(N) };
      if (v.v === 'base') return { ans: N, fam: 'num', unit: '', k, alt: { half: 5.54 * x * x, nosq: 16 * x }, tool: { id: 'chrom', q: { tr2: v.tr, w2: v.w } } };
      const H = v.L * 1000 / N;
      return { ans: H, fam: 'len', unit: 'µm', k: { ...k, H: f4(H) }, alt: { half: v.L * 1000 / (5.54 * x * x) }, tool: { id: 'chrom', q: { tr2: v.tr, w2: v.w, len: v.L } } };
    },
  },
  rf: {
    gen: (r, T) => {
      if (r.pick(['rf', 'd']) === 'd') return { v: 'd', Rf: r.v(T.v.Rf), df: r.v(T.v.df) };
      for (;;) {
        const o = r.v(T.v.o), f = r.v(T.v.f), s = r.step(1, 9.5, 0.1), Rf = (s - o) / (f - o);
        if (Rf >= 0.08 && Rf <= 0.92) return { v: 'rf', o, f, s };
      }
    },
    show: v => (v.v === 'd' ? { Rf: fd(v.Rf, 2), df: fd(v.df, 1) } : { o: fd(v.o, 1), f: fd(v.f, 1), s: fd(v.s, 1) }),
    solve: v => {
      if (v.v === 'd') { const d = v.Rf * v.df; return { ans: d, fam: 'len', unit: 'cm', k: { d: f4(d) }, alt: { div: v.df / v.Rf } }; }
      const ds = v.s - v.o, dm = v.f - v.o, Rf = ds / dm;
      return { ans: Rf, fam: 'num', unit: '', k: { ds: fd(ds, 1), dm: fd(dm, 1), Rf: f4(Rf) }, alt: { ...opt(far(v.s / v.f, Rf), { bottom: v.s / v.f }), inv: dm / ds } };
    },
  },
  // ===== 反応速度論と熱力学 =====
  'rate-law': {
    gen: (r, T) => {
      const q = r.pick(['half', 'conc']), n = r.pick([0, 1, 2]), a0 = r.v(T.v.a0), k = r.v(T.v[`k${n}`]);
      if (q === 'half') return { v: `half-${n}`, n, a0, k };
      const th = halfLife(n, a0, k), t = sig(th * (n === 0 ? 0.2 + 1.6 * r.f() : 0.2 + 2.8 * r.f()), 2);
      return { v: `conc-${n}`, n, a0, k, t };
    },
    show: (v, T, X) => ({ n: fn(v.n), a0: fs(v.a0, 2), k: fs(v.k, 2), ku: nm(X, 'ku', v.n), ...(v.t != null ? { t: fs(v.t, 2) } : {}) }),
    solve: v => {
      const { n, a0, k } = v, tool = { id: 'kinetics', q: { order: n, a0, k, ...(v.t != null ? { t: v.t } : {}) } };
      if (v.t == null) {
        const th = halfLife(n, a0, k), f = Math.LN2 / k;
        return { ans: th, fam: 'time', unit: 's', k: { th: f4(th), ka: fsci(k * a0, 3) },
          alt: { ...opt(n !== 1 && far(f, th), { first: f }), ...opt(n === 1 && far(lg(2) / k, th), { log: lg(2) / k }), ...opt(n === 2 && far(1 / k, th), { noa: 1 / k }), ...opt(n === 0 && far(a0 / k, th), { no2: a0 / k }) }, tool };
      }
      const a = rateConc(n, a0, k, v.t), e1 = a0 * Math.exp(-k * v.t);
      return { ans: a, fam: 'conc', unit: 'mol/L', k: { kt: fsci(k * v.t, 3), e: f4(Math.exp(-k * v.t)), inv: f4(1 / a0 + k * v.t), a: fsci(a, 4), ia: f4(1 / a0) },
        alt: { ...opt(n !== 1 && far(e1, a), { first: e1 }), ...opt(n === 1 && far(a0 * 10 ** (-k * v.t), a), { log: a0 * 10 ** (-k * v.t) }), ...opt(far(a0 - a, a), { used: a0 - a }) }, tool };
    },
  },
  arrhenius: {
    gen: (r, T) => {
      const q = r.pick(['ea', 'k2']), t1 = r.v(T.v.t1), t2 = t1 + r.int(5, 40), Ea = r.v(T.v.Ea), k1 = r.v(T.v.k1);
      if (q === 'k2') return { v: q, t1, t2, Ea, k1 };
      return { v: q, t1, t2, k1, k2: sig(k1 * Math.exp(Ea * 1000 / RGAS * (1 / (t1 + K0) - 1 / (t2 + K0))), 3) };
    },
    show: v => ({ t1: fn(v.t1), t2: fn(v.t2), k1: fs(v.k1, 2), ...(v.k2 != null ? { k2: fs(v.k2, 3) } : { Ea: fn(v.Ea) }) }),
    solve: (v, X) => {
      const R = X.D.c.R, T1 = v.t1 + K0, T2 = v.t2 + K0, inv = 1 / T1 - 1 / T2;
      const k = { T1: fd(T1, 2), T2: fd(T2, 2), inv: fsci(inv, 4) };
      if (v.v === 'ea') {
        const lk = ln(v.k2 / v.k1), Ea = arrhenius(T1, v.k1, T2, v.k2).ea / 1000, ec = v.t1 > 0 ? R * lk / (1 / v.t1 - 1 / v.t2) / 1000 : NaN;
        return { ans: Ea, fam: 'emol', unit: 'kJ/mol', k: { ...k, lk: f4(lk), Ea: f4(Ea) },
          alt: { log: R * lg(v.k2 / v.k1) / inv / 1000, ...opt(far(ec, Ea), { c: ec }) }, tool: { id: 'kinetics', q: { t1: v.t1, k1: v.k1, t2: v.t2, k2: v.k2 } } };
      }
      const x = v.Ea * 1000 / R * inv, k2 = v.k1 * Math.exp(x), kc = v.t1 > 0 ? v.k1 * Math.exp(v.Ea * 1000 / R * (1 / v.t1 - 1 / v.t2)) : NaN;
      return { ans: k2, fam: 'rate', unit: 's⁻¹', k: { ...k, x: f4(x), e: f4(Math.exp(x)), k2: fsci(k2, 4) },
        alt: { inv: v.k1 * Math.exp(-x), log: v.k1 * 10 ** x, ...opt(far(kc, k2), { c: kc }) }, tool: { id: 'kinetics', q: { t1: v.t1, k1: v.k1, t2: v.t2, k2: sig(k2, 4) } } };
    },
  },
  'gibbs-k': {
    gen: (r, T) => {
      const q = r.pick(['dg', 'k', 'pct']), t = r.v(T.v.t);
      if (q === 'dg') { for (;;) { const K = r.v(T.v.K); if (Math.abs(lg(K)) >= 0.3) return { v: q, t, K }; } }
      if (q === 'k') { for (;;) { const dG = r.v(T.v.dG); if (Math.abs(dG) >= 1) return { v: q, t, dG }; } }
      return { v: q, t, dd: r.v(T.v.dd) };
    },
    show: v => ({ t: fn(v.t), ...(v.K != null ? { K: fsci(v.K, 2) } : v.dG != null ? { dG: fd(v.dG, 1) } : { dd: fd(v.dd, 1) }) }),
    solve: (v, X) => {
      const R = X.D.c.R, Tk = v.t + K0, RT = R * Tk, k = { T: fd(Tk, 2), RT: f4(RT) };
      if (v.v === 'dg') {
        const dG = -RT * ln(v.K) / 1000;
        return { ans: dG, fam: 'emol', unit: 'kJ/mol', k: { ...k, lnK: f4(ln(v.K)), dG: f4(dG) },
          alt: { log: -RT * lg(v.K) / 1000, ...opt(v.t > 0 && far(-R * v.t * ln(v.K) / 1000, dG), { c: -R * v.t * ln(v.K) / 1000 }) } };
      }
      if (v.v === 'k') {
        const x = -v.dG * 1000 / RT, K = Math.exp(x);
        return { ans: K, fam: 'num', unit: '', k: { ...k, x: f4(x), K: fsci(K, 4) },
          alt: { log: 10 ** x, sign: Math.exp(-x), ...opt(v.t > 0 && far(Math.exp(-v.dG * 1000 / (R * v.t)), K), { c: Math.exp(-v.dG * 1000 / (R * v.t)) }) } };
      }
      const x = v.dd * 1000 / RT, K = Math.exp(x), p = K / (1 + K) * 100;
      return { ans: p, fam: 'frac', unit: '%', k: { ...k, x: f4(x), K: f4(K), p: f4(p) },
        alt: { ...opt(far(10 ** x / (1 + 10 ** x) * 100, p), { log: 10 ** x / (1 + 10 ** x) * 100 }), ...opt(v.t > 0 && far(100 * Math.exp(v.dd * 1000 / (R * v.t)) / (1 + Math.exp(v.dd * 1000 / (R * v.t))), p), { c: 100 * Math.exp(v.dd * 1000 / (R * v.t)) / (1 + Math.exp(v.dd * 1000 / (R * v.t))) }), ...opt(far(100 / (1 + K), p), { minor: 100 / (1 + K) }) } };
    },
  },
  // ===== 高分子 =====
  'mn-mw': {
    gen: (r, T) => {
      for (;;) {
        const w = [0, 1, 2].map(() => r.v(T.v.w)), M = [0, 1, 2].map(() => r.v(T.v.M));
        if (new Set(M).size < 3) continue;
        return { v: r.pick(['mn', 'mw', 'd']), w, M };
      }
    },
    show: v => Object.fromEntries([0, 1, 2].flatMap(i => [[`w${i + 1}`, fd(v.w[i], 1)], [`M${i + 1}`, fsci(v.M[i], 2)]])),
    solve: v => {
      const sw = sum(v.w), sn = sum(v.w.map((w, i) => w / v.M[i])), swm = sum(v.w.map((w, i) => w * v.M[i]));
      const Mn = sw / sn, Mw = swm / sw, D = Mw / Mn, avg = sum(v.M) / 3;
      const k = { sw: fd(sw, 1), sn: fsci(sn, 4), swm: fsci(swm, 4), Mn: fsci(Mn, 4), Mw: fsci(Mw, 4), D: f4(D) };
      if (v.v === 'mn') return { ans: Mn, fam: 'molar', unit: 'g/mol', k, alt: { ...opt(far(Mw, Mn), { mw: Mw }), ...opt(far(avg, Mn), { avg }) } };
      if (v.v === 'mw') return { ans: Mw, fam: 'molar', unit: 'g/mol', k, alt: { ...opt(far(Mn, Mw), { mn: Mn }), ...opt(far(avg, Mw), { avg }) } };
      return { ans: D, fam: 'num', unit: '', k, alt: { ...opt(far(1 / D, D), { inv: 1 / D }) } };
    },
  },
  carothers: {
    gen: (r, T) => {
      const q = r.pick(['xn', 'p', 'r']);
      if (q === 'xn') return { v: q, p: r.v(T.v.p) };
      if (q === 'p') return { v: q, Xn: r.v(T.v.Xn) };
      return { v: q, r: r.v(T.v.r), p: r.v(T.v.pr) };
    },
    show: v => ({ ...(v.p != null ? { p: fd(v.p, 3) } : {}), ...(v.Xn != null ? { Xn: fn(v.Xn) } : {}), ...(v.r != null ? { r: fd(v.r, 3) } : {}) }),
    solve: v => {
      if (v.v === 'xn') { const X = 1 / (1 - v.p); return { ans: X, fam: 'num', unit: '', k: { q: fd(1 - v.p, 3), X: f4(X) }, alt: { xw: (1 + v.p) / (1 - v.p), inv: 1 / v.p } }; }
      if (v.v === 'p') { const p = 1 - 1 / v.Xn; return { ans: p, fam: 'num', unit: '', dec: 4, k: { i: fs(1 / v.Xn, 4), p: fs(p, 5) }, alt: { ...opt(far((v.Xn - 1) / (v.Xn + 1), p, 0.0005), { xw: (v.Xn - 1) / (v.Xn + 1) }), inv: 1 / v.Xn } }; }
      const num = 1 + v.r, den = 1 + v.r - 2 * v.r * v.p, X = num / den;
      return { ans: X, fam: 'num', unit: '', k: { num: fd(num, 3), rp: fs(2 * v.r * v.p, 6), den: fs(den, 4), X: f4(X) }, alt: { ...opt(far(1 / (1 - v.p), X), { nor: 1 / (1 - v.p) }) } };
    },
  },
  // ===== 熱分析・X線・表面 =====
  bragg: {
    gen: (r, T, X) => {
      const q = r.pick(['d', 'tt', 'a']), lam = X.D.c.cu;
      if (q === 'd') return { v: q, tt: r.v(T.v.tt) };
      if (q === 'tt') return { v: q, d: r.v(T.v.d) };
      for (;;) {
        const hkl = r.pick(T.pick.hkl), S = [...hkl].reduce((s, c) => s + Number(c) ** 2, 0), a = r.v(T.v.a), s = lam * Math.sqrt(S) / (2 * a);
        if (s < 0.95) return { v: q, hkl, tt: rnd(2 * asind(s), 2) };
      }
    },
    show: (v, T, X) => ({ lam: fd(X.D.c.cu, 5), ...(v.tt != null ? { tt: fd(v.tt, 2), th: fd(v.tt / 2, 3) } : {}), ...(v.d != null ? { d: fd(v.d, 4) } : {}), ...(v.hkl ? { hkl: `(${v.hkl})`, S: fn([...v.hkl].reduce((s, c) => s + Number(c) ** 2, 0)) } : {}) }),
    solve: (v, X) => {
      const lam = X.D.c.cu;
      if (v.v === 'tt') {
        const s = lam / (2 * v.d), th = asind(s);
        return { ans: 2 * th, fam: 'ang', unit: '°', k: { s: f4(s), th: f4(th), tt: f4(2 * th) }, alt: { half: th } };
      }
      const s = sind(v.tt / 2), d = lam / (2 * s), dw = lam / (2 * sind(v.tt));
      if (v.v === 'd') return { ans: d, fam: 'len', unit: 'nm', k: { s: f4(s), d: f4(d) }, alt: { ...opt(far(dw, d), { tt: dw }), no2: 2 * d } };
      const S = [...v.hkl].reduce((t, c) => t + Number(c) ** 2, 0), a = d * Math.sqrt(S);
      return { ans: a, fam: 'len', unit: 'nm', k: { s: f4(s), d: f4(d), r: f4(Math.sqrt(S)), a: f4(a) }, alt: { ...opt(far(d * S, a), { nosqrt: d * S }), ...opt(far(dw * Math.sqrt(S), a), { tt: dw * Math.sqrt(S) }) } };
    },
  },
  scherrer: {
    gen: (r, T) => ({ tt: r.v(T.v.tt), b: r.v(T.v.b) }),
    show: (v, T, X) => ({ tt: fd(v.tt, 1), th: fd(v.tt / 2, 2), b: fd(v.b, 2), lam: fd(X.D.c.cu, 5), K: fd(X.D.c.ks, 1) }),
    solve: (v, X) => {
      const K = X.D.c.ks, lam = X.D.c.cu, br = v.b * D2R, c = cosd(v.tt / 2), D = K * lam / (br * c);
      return { ans: D, fam: 'len', unit: 'nm', k: { br: fsci(br, 4), c: f4(c), D: f4(D) }, alt: { deg: K * lam / (v.b * c), ...opt(far(K * lam / (br * cosd(v.tt)), D), { tt: K * lam / (br * cosd(v.tt)) }) } };
    },
  },
  // ===== 前処理と分析の品質管理 =====
  'mean-sd': {
    gen: (r, T, X) => {
      const q = r.pick(['sd', 'rsd', 'ci']), n = r.int(4, 7), mu = r.v(T.v.mu), rs = r.v(T.v.rsd), dp = Math.max(0, 3 - Math.floor(lg(mu)));
      for (;;) {
        const xs = Array.from({ length: n }, () => rnd(mu * (1 + rs / 100 * gauss(r)), dp));
        if (new Set(xs).size >= 3) return { v: q, xs, dp };
      }
    },
    show: (v, T, X) => {
      const tt = X.D.t95, sep = X.N.x.sep;
      return { xs: v.xs.map(x => fd(x, v.dp)).join(sep), n: fn(v.xs.length), df: fn(v.xs.length - 1),
        tab: Object.keys(tt).map(df => fillText(X.N.x.tdf, { df, t: fd(tt[df], 3) })).join(sep) };
    },
    solve: (v, X) => {
      const n = v.xs.length, m = sum(v.xs) / n, ss = sum(v.xs.map(x => (x - m) ** 2)), s = Math.sqrt(ss / (n - 1)), sp = Math.sqrt(ss / n), t = X.D.t95[n - 1];
      const k = { m: fs(m, 5), ss: fs(ss, 4), s: fs(s, 4), rsd: f4(s / m * 100), t: fd(t, 3), sq: f4(Math.sqrt(n)), ci: f4(t * s / Math.sqrt(n)) };
      if (v.v === 'sd') return { ans: s, fam: 'mconc', unit: 'mg/L', k, alt: { pop: sp, sem: s / Math.sqrt(n) } };
      if (v.v === 'rsd') return { ans: s / m * 100, fam: 'frac', unit: '%', k, alt: { pop: sp / m * 100, sem: s / Math.sqrt(n) / m * 100 } };
      const tn = X.D.t95[n];
      return { ans: t * s / Math.sqrt(n), fam: 'mconc', unit: 'mg/L', k, alt: { non: t * s, ...opt(tn != null && far(tn * s / Math.sqrt(n), t * s / Math.sqrt(n)), { tn: tn * s / Math.sqrt(n) }), z: 1.96 * s / Math.sqrt(n) } };
    },
  },
  'lod-loq': {
    gen: (r, T) => ({ v: r.pick(['lod', 'loq', 'lod3']), sb: r.v(T.v.sb), S: r.v(T.v.S) }),
    show: v => ({ sb: fd(v.sb, 4), S: fs(v.S, 3) }),
    solve: v => {
      const f = { lod: 3.3, loq: 10, lod3: 3 }[v.v], x = f * v.sb / v.S;
      const alt = { mult: f * v.sb * v.S };
      if (v.v === 'lod') alt.k3 = 3 * v.sb / v.S;
      if (v.v === 'lod3') alt.k33 = 3.3 * v.sb / v.S;
      if (v.v === 'loq') Object.assign(alt, { lod33: 3.3 * v.sb / v.S, lod3: 3 * v.sb / v.S });
      return { ans: x, fam: 'mconc', unit: 'mg/L', k: { x: f4(x), r: fs(v.sb / v.S, 4) }, alt };
    },
  },
  recovery: {
    gen: (r, T) => {
      for (;;) {
        const c0 = r.v(T.v.c0), a = r.pick(T.pick.a), R = r.step(70, 120, 1) / 100;
        if (a < 0.5 * c0 || a > 5 * c0) continue;
        return { c0, a, cs: rnd(c0 + a * R, 2) };
      }
    },
    show: v => ({ c0: fd(v.c0, 2), a: fd(v.a, 2), cs: fd(v.cs, 2) }),
    solve: v => {
      const R = (v.cs - v.c0) / v.a * 100;
      return { ans: R, fam: 'frac', unit: '%', k: { d: fd(v.cs - v.c0, 2), R: f4(R) }, alt: { ...opt(far(v.cs / (v.c0 + v.a) * 100, R), { tot: v.cs / (v.c0 + v.a) * 100 }), nosub: v.cs / v.a * 100 } };
    },
  },
  // ===== 合成とプロセスの指標 =====
  yield: {
    gen: (r, T, X) => {
      if (r.pick(['one', 'overall']) === 'overall') return { v: 'overall', ys: Array.from({ length: r.int(2, 5) }, () => r.step(50, 98, 1)) };
      const rx = r.pick(T.pick.rx), [MA, MB, MP] = X.D.rx[rx];
      for (;;) {
        const mA = r.v(T.v.m), ratio = 0.6 + 1.4 * r.f();
        if (Math.abs(ratio - 1) < 0.1) continue;
        const nA = mA / MA, mB = rnd(nA * ratio * MB, 2), y = r.step(40, 95, 0.1) / 100, lim = Math.min(nA, mB / MB);
        return { v: 'one', rx, mA, mB, mP: rnd(lim * y * MP, 2) };
      }
    },
    show: (v, T, X) => (v.v === 'overall' ? { n: fn(v.ys.length), ys: v.ys.map(y => `${fn(y)} %`).join(X.N.x.sep) } : {
      A: nm(X, 'ra', v.rx), B: nm(X, 'rb', v.rx), P: nm(X, 'rp', v.rx), MA: fd(X.D.rx[v.rx][0], 2), MB: fd(X.D.rx[v.rx][1], 2), MP: fd(X.D.rx[v.rx][2], 2),
      mA: fd(v.mA, 2), mB: fd(v.mB, 2), mP: fd(v.mP, 2) }),
    solve: (v, X) => {
      if (v.v === 'overall') {
        const Y = 100 * v.ys.reduce((p, y) => p * y / 100, 1), mean = sum(v.ys) / v.ys.length;
        return { ans: Y, fam: 'frac', unit: '%', k: { prod: v.ys.map(y => fd(y / 100, 2)).join(' × '), Y: f4(Y) }, alt: { ...opt(far(mean, Y), { mean }), ...opt(far(Math.min(...v.ys), Y), { min: Math.min(...v.ys) }) } };
      }
      const [MA, MB, MP] = X.D.rx[v.rx], nA = v.mA / MA, nB = v.mB / MB, nP = v.mP / MP, lim = Math.min(nA, nB), mlim = nA <= nB ? v.mA : v.mB, Y = nP / lim * 100;
      return { ans: Y, fam: 'frac', unit: '%', k: { nA: fsci(nA, 4), nB: fsci(nB, 4), lim: nm(X, nA <= nB ? 'ra' : 'rb', v.rx), nl: fsci(lim, 4), nP: fsci(nP, 4), Y: f4(Y) },
        alt: { ...opt(far(nP / Math.max(nA, nB) * 100, Y), { excess: nP / Math.max(nA, nB) * 100 }), ...opt(far(v.mP / mlim * 100, Y), { mass: v.mP / mlim * 100 }) } };
    },
  },
  'atom-economy': {
    gen: (r, T) => {
      const rx = r.pick(T.pick.rx);
      return r.pick(['ae', 'waste']) === 'ae' ? { v: 'ae', rx } : { v: 'waste', rx, mp: r.v(T.v.mp) };
    },
    show: (v, T, X) => ({ eq: nm(X, 'eq', v.rx), ...(v.mp != null ? { mp: fs(v.mp, 3) } : {}) }),
    solve: (v, X) => {
      const { in: ins, p } = X.D.ae[v.rx], S = sum(ins), AE = p / S * 100;
      const k = { S: fd(S, Math.max(...[...ins, p].map(dpOf))), AE: f4(AE) };
      if (v.v === 'ae') return { ans: AE, fam: 'frac', unit: '%', k, alt: { ...opt(far(p / ins[0] * 100, AE), { first: p / ins[0] * 100 }), ...opt(far(100 - AE, AE), { rev: 100 - AE }) } };
      const w = v.mp * (S - p) / p;
      return { ans: w, fam: 'mass', unit: 'kg', k: { ...k, bp: fd(S - p, Math.max(...[...ins, p].map(dpOf))), w: f4(w) }, alt: { ...opt(far(v.mp * (S - p) / S, w), { frac: v.mp * (S - p) / S }) } };
    },
  },
  'e-factor': {
    gen: (r, T) => {
      const P = r.v(T.v.P), Rin = r.step(Math.round(P * 1.3), P * 5, 1), S = r.v(T.v.S);
      return r.pick(['e', 'pmi']) === 'e' ? { v: 'e', P, Rin, S, rec: r.pick(T.pick.rec) } : { v: 'pmi', P, Rin, S, W: r.v(T.v.W) };
    },
    show: v => ({ P: fn(v.P), Rin: fn(v.Rin), S: fn(v.S), ...(v.rec != null ? { rec: fn(v.rec) } : { W: fn(v.W) }) }),
    solve: v => {
      if (v.v === 'e') {
        const ws = v.S * (1 - v.rec / 100), waste = v.Rin - v.P + ws, E = waste / v.P;
        return { ans: E, fam: 'num', unit: '', k: { rw: fn(v.Rin - v.P), ws: fs(ws, 4), w: fs(waste, 4), E: f4(E) },
          alt: { ...opt(v.rec > 0 && far((v.Rin - v.P + v.S) / v.P, E), { allsolv: (v.Rin - v.P + v.S) / v.P }), ...opt(far(E + 1, E), { pmi: E + 1 }) } };
      }
      const tot = v.Rin + v.S + v.W, PMI = tot / v.P;
      return { ans: PMI, fam: 'num', unit: '', k: { tot: fn(tot), PMI: f4(PMI) },
        alt: { ...opt(far(PMI - 1, PMI), { e: PMI - 1 }), ...opt(v.W > 0 && far((v.Rin + v.S) / v.P, PMI), { nowater: (v.Rin + v.S) / v.P }) } };
    },
  },
  ee: {
    gen: (r, T) => {
      const q = r.pick(['ee', 'major', 'rot']);
      if (q === 'ee') { for (;;) { const mR = r.v(T.v.m), mS = r.v(T.v.m); if (Math.abs(mR - mS) >= 0.05 * (mR + mS)) return { v: q, mR, mS }; } }
      if (q === 'major') return { v: q, ee: r.v(T.v.ee) };
      const amax = r.v(T.v.amax) * (r.f() < 0.5 ? -1 : 1), e = r.step(10, 99, 1) / 100;
      return { v: q, amax, aobs: rnd(amax * e, 1) };
    },
    show: v => (v.v === 'ee' ? { mR: fd(v.mR, 1), mS: fd(v.mS, 1) } : v.v === 'major' ? { ee: fd(v.ee, 1) } : { amax: (v.amax > 0 ? '+' : '') + fd(v.amax, 1), aobs: (v.aobs > 0 ? '+' : '') + fd(v.aobs, 1) }),
    solve: v => {
      if (v.v === 'ee') {
        const t = v.mR + v.mS, ee = Math.abs(v.mR - v.mS) / t * 100, mj = Math.max(v.mR, v.mS) / t * 100;
        return { ans: ee, fam: 'frac', unit: '%', k: { t: fd(t, 1), d: fd(Math.abs(v.mR - v.mS), 1), mj: f4(mj), mn: f4(100 - mj), ee: f4(ee) }, alt: { major: mj, ...opt(far(Math.max(v.mR, v.mS) / Math.min(v.mR, v.mS) * 100, ee), { ratio: Math.max(v.mR, v.mS) / Math.min(v.mR, v.mS) * 100 }) } };
      }
      if (v.v === 'major') {
        const mj = (100 + v.ee) / 2;
        return { ans: mj, fam: 'frac', unit: '%', k: { mj: f4(mj), mn: f4(100 - mj) }, alt: { ...opt(far(v.ee, mj), { ee: v.ee }), minor: 100 - mj } };
      }
      const ee = v.aobs / v.amax * 100;
      return { ans: ee, fam: 'frac', unit: '%', k: { ee: f4(ee), mj: f4((100 + ee) / 2) }, alt: { ...opt(far((100 + ee) / 2, ee), { major: (100 + ee) / 2 }), inv: v.amax / v.aobs * 100 } };
    },
  },
};

// ---- 問題を作る: 型のデータ T(data/drill.json の1件)、種 seed → { vals, show, sol } ----
export function makeProblem(T, seed, X) {
  const def = TYPES[T.id];
  const r = makeRng(seed, T.id);
  const vals = def.gen(r, T, X);
  const auto = {};
  for (const [k, spec] of Object.entries(T.v ?? {})) if (typeof vals[k] === 'number') auto[k] = showSpec(vals[k], spec);
  const show = { ...auto, ...(def.show ? def.show(vals, T, X) : {}) };
  const sol = def.solve(vals, X);
  return { vals, show, sol };
}
// 文章の場合分け: 文字ならそのまま、{ 場合: 文 } なら vals.v(なければその頭「hypo-pro」→「hypo」、それもなければ「_」)
export const pickText = (x, v) => (typeof x === 'string' || Array.isArray(x) || x == null ? x : x[v] ?? x[String(v).split('-')[0]] ?? x[String(v).split('-').at(-1)] ?? x._);
// 許容差(場合ごとに tolv で変えられる)
export const tolOf = (T, v) => T.tolv?.[v] ?? T.tol;
export const fillText = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// ---- 判定 ----
// 値 x(単位 u)を、答え(sol.unit)と比べる。tol は相対の許容差(0.01 = ±1 %)
// 戻り値: { ok, err(相対のずれ)、hint: 間違いのID か 一般の指摘 { kind, ... } }
export function judge(sol, x, u, tol) {
  const fam = sol.fam;
  const y = convert(fam, x, u, sol.unit);
  // 温度は絶対温度で比べる(℃の 0 は物理的な基準ではないので)
  const abs = fam === 'temp' ? z => convert(fam, z, sol.unit, 'K') : z => z;
  const near = (a, b, t = tol) => Math.abs(abs(a) - abs(b)) <= t * Math.abs(abs(b)) + 1e-300;
  const err = sol.ans === 0 ? Math.abs(y) : (abs(y) - abs(sol.ans)) / Math.abs(abs(sol.ans));
  if (near(y, sol.ans)) return { ok: true, err, y };
  // その型によくある間違い
  const hits = Object.entries(sol.alt ?? {}).filter(([, a]) => Number.isFinite(a) && near(y, a, Math.max(tol, 0.005))).map(([id]) => id);
  if (hits.length) return { ok: false, err, y, hint: { kind: 'alt', id: hits[0], ids: hits } };
  // 符号
  if (near(-y, sol.ans)) return { ok: false, err, y, hint: { kind: 'sign' } };
  // 入れた数値が、同じ家族の別の単位で表した答えと同じ(単位の取り違え)
  if (fam !== 'temp') {
    for (const w of Object.keys(UNITS[fam])) {
      if (w === u) continue;
      if (near(x, convert(fam, sol.ans, sol.unit, w))) return { ok: false, err, y, hint: { kind: 'unit', u: w } };
    }
  } else if (Math.abs(x - convert(fam, sol.ans, sol.unit, u === 'K' ? '°C' : 'K')) <= tol * convert(fam, sol.ans, sol.unit, 'K')) return { ok: false, err, y, hint: { kind: 'unit', u: u === 'K' ? '°C' : 'K' } };
  // 10 の累乗だけずれている
  if (fam !== 'temp' && y / sol.ans > 0) {
    const p = Math.log10(y / sol.ans), n = Math.round(p);
    if (n && Math.abs(p - n) <= Math.log10(1 + tol)) return { ok: false, err, y, hint: { kind: 'pow', n } };
  }
  if (Math.abs(err) <= 0.05) return { ok: false, err, y, hint: { kind: 'close' } };
  return { ok: false, err, y };
}

// ======================================================================
// ---- ここから画面 ----
const app = typeof document !== 'undefined' ? document.getElementById('dr-app') : null;
const dataEl = typeof document !== 'undefined' ? document.getElementById('dr-data') : null;
if (app && dataEl) ui(JSON.parse(dataEl.textContent));

function ui(D) {
  const S = D.t;
  const X = { D: D.data, N: D.names };
  const byId = Object.fromEntries(D.types.map(T => [T.id, T]));
  const groupName = Object.fromEntries(D.groups.map(g => [g.id, g.name]));
  const $ = s => app.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmtS = (k, v = {}) => fillText(S[k] ?? k, v);
  // ずれ(%)。1 % 未満は小数2桁(ごく小さいずれを 7.0×10⁻⁵ % のように出さない)
  const errTxt = e => { const a = Math.abs(e) * 100; return a < 0.005 ? fd(0, 2) : `${e >= 0 ? '+' : '−'}${a >= 1 ? fs(a, 2) : fd(a, 2)}`; };
  const ulabel = u => (u === '' ? S.drill_unit_none : D.unitLabels?.[u] ?? u);

  // ---- 記録(localStorage。使えなくても動く) ----
  // 同じオリジン(github.io)のほかのサイトの記録と混ざらないように、鍵にサイト名(store.js の NS と同じ 'chem')をつける
  const KEY = `chem:drill:${document.documentElement.dataset.base ?? '/'}:v1`;
  const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); return d && typeof d === 'object' && d.t && typeof d.t === 'object' ? d : { t: {} }; } catch { return { t: {} }; } };
  let rec = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch {} };
  const note = (id, ok) => {
    const x = rec.t[id] ?? (rec.t[id] = { ok: 0, ng: 0 });
    if (ok) x.ok++; else x.ng++;
    x.last = ok ? 1 : 0;
    x.at = Date.now();
    save();
  };

  // ---- 選ぶところ ----
  const pick = $('#dr-pick');
  const selG = pick.elements.group, selT = pick.elements.type;
  const fillTypes = () => {
    const g = selG.value, cur = selT.value;
    selT.replaceChildren(new Option(S.drill_all_types, ''), ...D.types.filter(T => !g || T.group === g).map(T => new Option(T.name, T.id)));
    if ([...selT.options].some(o => o.value === cur)) selT.value = cur;
  };
  selG.addEventListener('change', fillTypes);

  // ---- 出題の状態 ----
  let set = null; // { list: [型ID…], i, results: [{ id, ok }] }
  let cur = null; // { T, seed, p, done }
  const card = $('#dr-card'), sum = $('#dr-sum');
  const qText = $('.dr-q'), meta = $('.dr-meta'), form = $('#dr-ans'), input = form.elements.ans, unitSel = form.elements.unit;
  const msg = $('.dr-msg'), res = $('.dr-res'), verdict = $('.dr-verdict'), hintEl = $('.dr-hint'), stepsEl = $('.dr-steps'), linksEl = $('.dr-links');
  const nextBtn = $('[data-next]'), againBtn = $('[data-again]'), shareBtn = $('[data-share]'), giveBtn = $('[data-give]');

  // まちがえた型を多めに(最後にまちがえた型は4倍、まちがえた回数が多いほど重く)
  const weight = id => { const x = rec.t[id]; if (!x) return 1; return 1 + (x.last === 0 ? 3 : 0) + Math.min(x.ng, 4) * 0.5 - Math.min(x.ok, 4) * 0.1; };
  const choose = (ids, n, weak) => {
    const out = [];
    let pool = [...ids];
    while (out.length < n) {
      if (!pool.length) pool = [...ids];
      const w = pool.map(id => (weak ? weight(id) : 1)), tot = w.reduce((a, b) => a + b, 0);
      let x = Math.random() * tot, i = 0;
      while (x > w[i] && i < pool.length - 1) x -= w[i++];
      // 型が少なくて同じ型をくり返すときも、続けて同じ型にはしない
      if (pool.length > 1 && pool[i] === out.at(-1)) continue;
      out.push(pool[i]);
      if (ids.length >= n) pool.splice(i, 1);
    }
    return out;
  };
  const newSeed = () => 1 + Math.floor(Math.random() * 99999);
  const setUrl = () => {
    const p = new URLSearchParams(location.search);
    for (const k of ['t', 's']) p.delete(k);
    if (cur) { p.set('t', cur.T.id); p.set('s', String(cur.seed)); }
    const q = p.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  };

  function show(id, seed) {
    const T = byId[id];
    let p;
    try { p = makeProblem(T, seed, X); } catch (e) { console.error(e); return; }
    cur = { T, seed, p, done: false };
    card.hidden = false;
    sum.hidden = true;
    meta.replaceChildren(
      ...(set ? [el('span', 'dr-count', fmtS('drill_n_of', { i: set.i + 1, n: set.list.length }))] : []),
      el('span', 'chip dr-chip', groupName[T.group]),
      el('strong', 'dr-name', T.name),
    );
    const vars = { ...p.show };
    qText.textContent = fillText(pickText(T.q, p.vals.v), vars);
    $('.dr-ask').textContent = fmtS('drill_answer_in', { tol: tolPct(tolOf(T, p.vals.v)), sig: T.sig });
    msg.hidden = true;
    unitSel.replaceChildren(...Object.keys(UNITS[p.sol.fam]).map(u => new Option(ulabel(u), u)));
    unitSel.value = p.sol.unit;
    unitSel.hidden = unitSel.options.length < 2;
    $('.dr-unit-one').textContent = unitSel.hidden ? ulabel(p.sol.unit) : '';
    input.value = '';
    input.disabled = false;
    form.querySelector('button[type=submit]').disabled = false;
    giveBtn.hidden = false;
    nextBtn.hidden = true;
    res.hidden = true;
    setUrl();
    try { input.focus({ preventScroll: true }); } catch {}
  }

  function answer(given) {
    if (!cur || cur.done) return;
    const { T, p } = cur, sol = p.sol;
    let x = null, u = unitSel.value, j = null;
    if (!given) {
      const a = parseAnswer(input.value, sol.fam);
      if (!a || a.bad) { msg.textContent = a ? fmtS('drill_bad_unit', { u: a.bad }) : S.drill_bad_input; msg.hidden = false; return; }
      msg.hidden = true;
      if (a.u) { u = a.u; unitSel.value = u; }
      x = a.v;
      j = judge(sol, x, u, tolOf(T, p.vals.v));
    }
    cur.done = true;
    input.disabled = true;
    form.querySelector('button[type=submit]').disabled = true;
    giveBtn.hidden = true;
    const ok = !!j?.ok;
    note(T.id, ok);
    if (set) set.results.push({ id: T.id, ok });
    // 判定
    // 整数で答える型(不飽和度など)は sol.dec の桁で
    const ansTxt = `${sol.dec != null ? fd(sol.ans, sol.dec) : fs(sol.ans, T.sig)}${sol.unit ? `${usp()}${ulabel(sol.unit)}` : ''}`;
    verdict.className = `dr-verdict ${ok ? 'ok' : 'ng'}`;
    verdict.replaceChildren(el('span', 'dr-mark', ok ? S.drill_correct : given ? S.drill_shown : S.drill_incorrect),
      el('span', 'dr-ans-line', fmtS('drill_answer_is', { a: ansTxt })),
      ...(j ? [el('span', 'dr-you', fmtS('drill_you', { a: `${fs(x, 4)}${u ? `${usp()}${ulabel(u)}` : ''}`, e: errTxt(j.err) }))] : []));
    // 間違いの指摘
    const H = j?.hint;
    let hint = '';
    if (H?.kind === 'alt') {
      // 同じ値になる間違いが複数あるときは、文の違うものを並べる
      const texts = [...new Set((H.ids ?? [H.id]).map(id => fillText(T.mistakes[id] ?? '', { ...p.show, ...p.sol.k })).filter(Boolean))];
      hint = texts.length > 1 ? [S.drill_h_either, ...texts.map(t => `${bullet()}${t}`)].join('\n') : texts[0] ?? '';
    }
    else if (H?.kind === 'sign') hint = S.drill_h_sign;
    else if (H?.kind === 'unit') hint = fmtS('drill_h_unit', { u: ulabel(H.u), a: fs(convert(sol.fam, sol.ans, sol.unit, u), 4), uu: ulabel(u) });
    else if (H?.kind === 'pow') hint = fmtS('drill_h_pow', { n: (H.n > 0 ? '' : '−') + Math.abs(H.n) });
    else if (H?.kind === 'close') hint = fmtS('drill_h_close', { tol: tolPct(tolOf(T, p.vals.v)) });
    hintEl.textContent = hint;
    hintEl.hidden = !hint;
    // 途中式
    const vars = { ...p.show, ...p.sol.k };
    const steps = pickText(T.steps, p.vals.v) ?? [];
    const ol = el('ol');
    for (const s of steps) ol.append(el('li', null, fillText(s, vars)));
    stepsEl.replaceChildren(el('h3', null, S.drill_steps), ol);
    stepsEl.hidden = false;
    // リンク(計算ツールを同じ数値で、用語、やさしい解説)
    linksEl.replaceChildren();
    if (sol.tool && T.tools?.[sol.tool.id]) {
      const t = T.tools[sol.tool.id];
      const q = new URLSearchParams(Object.entries(sol.tool.q).map(([k, v]) => [k, String(v)]));
      const a = el('a', 'btn btn-ghost btn-small', t.n);
      a.href = `${t.u}?${q}`;
      linksEl.append(el('p', 'dr-tool', S.drill_tool_lead), a);
    }
    if (T.terms?.length || T.learn?.length) {
      const p2 = el('p', 'term-chips');
      p2.append(el('span', 'muted', `${S.drill_related}${colon()}`));
      for (const x of [...(T.learn ?? []), ...(T.terms ?? [])]) { const a = el('a', 'chip', x.n); a.href = x.u; p2.append(a, ' '); }
      linksEl.append(p2);
    }
    if (T.fml?.length) {
      const p3 = el('p', 'term-chips');
      p3.append(el('span', 'muted', `${S.nav_formulas}${colon()}`));
      for (const x of T.fml) { const a = el('a', 'chip', x.n); a.href = x.u; p3.append(a, ' '); }
      linksEl.append(p3);
    }
    linksEl.hidden = !linksEl.childNodes.length;
    res.hidden = false;
    nextBtn.textContent = set && set.i + 1 >= set.list.length ? S.drill_to_summary : S.drill_next;
    nextBtn.hidden = false;
    renderRec();
    try { res.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
  }

  function next() {
    if (set) {
      set.i++;
      if (set.i >= set.list.length) return summary();
      return show(set.list[set.i], newSeed());
    }
    const ids = selected();
    show(choose(ids, 1, pick.elements.weak.checked)[0], newSeed());
  }
  const selected = () => (selT.value ? [selT.value] : D.types.filter(T => !selG.value || T.group === selG.value).map(T => T.id));

  function summary() {
    card.hidden = true;
    sum.hidden = false;
    const n = set.results.length, ok = set.results.filter(x => x.ok).length;
    $('.dr-score').textContent = fmtS('drill_score', { ok, n });
    const miss = [...new Set(set.results.filter(x => !x.ok).map(x => x.id))];
    const ul = $('.dr-miss');
    ul.replaceChildren(...miss.map(id => {
      const li = el('li');
      const b = el('button', 'btn btn-ghost btn-small', fmtS('drill_retry_type', { name: byId[id].name }));
      b.type = 'button';
      b.addEventListener('click', () => { set = null; selG.value = byId[id].group; fillTypes(); selT.value = id; show(id, newSeed()); });
      li.append(b);
      return li;
    }));
    $('.dr-miss-h').hidden = !miss.length;
    cur = null;
    setUrl();
    set.done = true;
    try { sum.scrollIntoView({ block: 'nearest' }); } catch {}
  }

  function start() {
    const n = Number(pick.elements.n.value);
    const ids = selected();
    if (n > 1) {
      set = { list: choose(ids, n, pick.elements.weak.checked), i: 0, results: [] };
      show(set.list[0], newSeed());
    } else {
      set = null;
      show(choose(ids, 1, pick.elements.weak.checked)[0], newSeed());
    }
    try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch {}
  }

  // ---- 記録の表示 ----
  function renderRec() {
    const box = $('.dr-rec-body');
    const rows = D.groups.map(g => {
      const ids = D.types.filter(T => T.group === g.id).map(T => T.id);
      const ok = ids.reduce((s, id) => s + (rec.t[id]?.ok ?? 0), 0), ng = ids.reduce((s, id) => s + (rec.t[id]?.ng ?? 0), 0);
      return { g, ok, ng, weak: ids.filter(id => rec.t[id]?.last === 0) };
    });
    const any = rows.some(r => r.ok + r.ng);
    box.replaceChildren();
    if (!any) { box.append(el('p', 'muted', S.drill_rec_empty)); $('[data-clear]').hidden = true; return; }
    $('[data-clear]').hidden = false;
    const table = el('table', 'dr-rec-table');
    const tr = el('tr');
    for (const h of [S.drill_rec_group, S.drill_rec_done, S.drill_rec_rate]) tr.append(el('th', null, h));
    table.append(el('thead'));
    table.tHead.append(tr);
    const tb = el('tbody');
    for (const r of rows) {
      if (!(r.ok + r.ng)) continue;
      const row = el('tr');
      row.append(el('th', null, r.g.name), el('td', null, String(r.ok + r.ng)), el('td', null, `${Math.round(r.ok / (r.ok + r.ng) * 100)} %`));
      tb.append(row);
    }
    table.append(tb);
    box.append(table);
    const weak = rows.flatMap(r => r.weak);
    if (weak.length) {
      const p = el('p', 'dr-weak');
      p.append(el('span', 'muted', `${S.drill_rec_weak}${colon()}`));
      for (const id of weak) {
        const b = el('button', 'chip', byId[id].name);
        b.type = 'button';
        b.addEventListener('click', () => { set = null; selG.value = byId[id].group; fillTypes(); selT.value = id; show(id, newSeed()); try { card.scrollIntoView({ block: 'start' }); } catch {} });
        p.append(b, ' ');
      }
      box.append(p);
    }
  }

  // ---- つなぐ ----
  pick.addEventListener('submit', e => { e.preventDefault(); start(); });
  form.addEventListener('submit', e => { e.preventDefault(); answer(false); });
  giveBtn.addEventListener('click', () => answer(true));
  nextBtn.addEventListener('click', next);
  againBtn.addEventListener('click', () => { if (!cur) return; const id = cur.T.id; if (set) set = null; show(id, newSeed()); });
  shareBtn.addEventListener('click', async () => {
    if (!cur) return;
    const url = `${location.origin}${location.pathname}?t=${encodeURIComponent(cur.T.id)}&s=${cur.seed}`;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch {}
    if (!ok) { try { const ta = el('textarea'); ta.value = url; document.body.append(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {} }
    const old = shareBtn.textContent;
    shareBtn.textContent = ok ? shareBtn.dataset.done : url;
    setTimeout(() => { shareBtn.textContent = old; }, 2000);
  });
  $('[data-sum-again]').addEventListener('click', start);
  $('[data-clear]').addEventListener('click', () => { if (!confirm(S.drill_rec_clear_q)) return; rec = { t: {} }; save(); renderRec(); });
  // 静的な一覧の「この型を解く」(JS があるときは、ページを読み直さずに出す)
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[data-drill-type]');
    if (!a) return;
    e.preventDefault();
    const id = a.dataset.drillType;
    set = null;
    selG.value = byId[id].group;
    fillTypes();
    selT.value = id;
    show(id, newSeed());
    try { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch {}
  });

  app.hidden = false;
  fillTypes();
  renderRec();
  // URL の ?t=型&s=種(s がなければ種を新しく)。?g=分野 で分野を選んでおく
  const params = new URLSearchParams(location.search);
  const g0 = params.get('g');
  if (g0 && groupName[g0]) { selG.value = g0; fillTypes(); }
  const t0 = params.get('t');
  if (t0 && byId[t0]) {
    selG.value = byId[t0].group;
    fillTypes();
    selT.value = t0;
    const s0 = Number(params.get('s'));
    show(t0, Number.isInteger(s0) && s0 > 0 ? s0 : newSeed());
  }
}
