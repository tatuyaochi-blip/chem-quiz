// 化学の計算ツールの計算部分(画面に依存しない純粋な関数)。ページのスクリプトと tools/test-calc.js が同じ関数を使う。

// 緩衝液: ヘンダーソン・ハッセルバルヒの式 pH = pKa + log10([A⁻]/[HA])
export const bufferPH = (pka, ha, a) => (ha > 0 && a > 0 ? pka + Math.log10(a / ha) : NaN);
// 目標の pH に必要な比 r = [A⁻]/[HA] と、全濃度 total を保ったときの各成分の濃度
export function bufferMix(pka, target, total) {
  const r = 10 ** (target - pka);
  return { ratio: r, a: (total * r) / (1 + r), ha: total / (1 + r) };
}

// ランベルト・ベールの法則 A = ε·c·l。透過率 T(%) と吸光度の換算
export const absFromT = t => -Math.log10(t / 100);
export const tFromAbs = A => 100 * 10 ** -A;
export const beerConc = (A, eps, l) => A / (eps * l);

// クロマトグラフィー: 保持係数 k、分離係数 α、分離度 Rs(ベースライン幅)、理論段数 N = 16(tR/W)²
export const retentionFactor = (tr, t0) => (tr - t0) / t0;
export const resolution = (t1, t2, w1, w2) => (2 * (t2 - t1)) / (w1 + w2);
export const plates = (tr, w) => 16 * (tr / w) ** 2;
export const platesHalf = (tr, wHalf) => 5.54 * (tr / wHalf) ** 2;

// 質量分析の同位体パターン: 塩素 ncl 個・臭素 nbr 個の (a + b)ⁿ(c + d)ᵐ の展開(重い同位体の個数ごとの存在確率)
export const CL = [0.7576, 0.2424], BR = [0.5069, 0.4931];
export function isotopePattern(ncl, nbr) {
  let p = [1];
  for (const [a, b] of [...Array(ncl).fill(CL), ...Array(nbr).fill(BR)]) {
    const q = Array(p.length + 1).fill(0);
    p.forEach((v, i) => { q[i] += v * a; q[i + 1] += v * b; });
    p = q;
  }
  return p;
}
// M+1 の目安(¹³C 1.07 % だけから): n × 1.07/98.93 × 100 (%)
export const mPlus1 = nc => (100 * nc * 1.07) / 98.93;

// 反応速度: n 次の積分形と半減期、90 % 反応する時間
export const R = 8.314;
export const conc = (n, a0, k, t) => (n === 0 ? Math.max(a0 - k * t, 0) : n === 1 ? a0 * Math.exp(-k * t) : a0 / (1 + k * a0 * t));
export const halfLife = (n, a0, k) => (n === 0 ? a0 / (2 * k) : n === 1 ? Math.LN2 / k : 1 / (k * a0));
export const t90 = (n, a0, k) => (n === 0 ? (0.9 * a0) / k : n === 1 ? Math.LN10 / k : 9 / (k * a0));
// アレニウスの式: 2温度(K)の速度定数から Ea (J/mol) と頻度因子 A
export function arrhenius(T1, k1, T2, k2) {
  const inv = 1 / T1 - 1 / T2;
  const ea = T1 > 0 && T2 > 0 && k1 > 0 && k2 > 0 && inv !== 0 ? (R * Math.log(k2 / k1)) / inv : NaN;
  return { ea, A: k1 * Math.exp(ea / (R * T1)) };
}

// 酸塩基の滴定曲線: 一塩基の酸(または塩基)を強塩基(または強酸)で滴定する。
// t = { base: 塩基を滴定するか, strong: 強酸・強塩基か, c: 試料の濃度 mol/L, v: 試料の体積 mL, pk: 弱酸の pKa(塩基なら pKb), ct: 滴定剤の濃度 mol/L }
// pH は電荷収支(水の電離 Kw を含む)を数値で解いた厳密な値。活量係数は 1、Kw は 25 ℃ の 1.0×10⁻¹⁴
export const KW = 1e-14;
export const titrEqVol = t => (t.c * t.v) / t.ct;
// 電荷収支の(正の電荷 − 負の電荷)。[H⁺] = h について単調に増える
function titrBalance(t, V, h, kw) {
  const vt = t.v + V, ca = (t.c * t.v) / vt, cx = (t.ct * V) / vt; // 試料の全濃度と滴定剤のイオンの濃度(薄まったあと)
  if (!t.base) { // 酸: [H⁺] + [Na⁺] = [OH⁻] + [A⁻]
    const a = t.strong ? 1 : 1 / (1 + h / 10 ** -t.pk);
    return h + cx - kw / h - ca * a;
  }
  // 塩基: [H⁺] + [BH⁺] = [OH⁻] + [Cl⁻]。BH⁺ の Ka = Kw/Kb
  const b = t.strong ? 1 : 1 / (1 + kw / 10 ** -t.pk / h);
  return h + ca * b - kw / h - cx;
}
// 滴定剤を V mL 加えたときの pH(pH −3〜17 を二分法で)
export function titrationPH(t, V, kw = KW) {
  if (!(t.c > 0 && t.v > 0 && t.ct > 0 && V >= 0)) return NaN;
  let lo = -3, hi = 17; // lo では収支が正、hi では負
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (titrBalance(t, V, 10 ** -mid, kw) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// 逆に、pH になるまでに要る滴定剤の体積 V mL(電荷収支を V について解いた式)。滴定前にすでにその pH を越えていれば負、届かなければ NaN
export function titrationVol(t, pH, kw = KW) {
  const h = 10 ** -pH, d = h - kw / h;
  if (!t.base) {
    const a = t.strong ? 1 : 1 / (1 + h / 10 ** -t.pk);
    return t.ct + d > 0 ? (t.v * (a * t.c - d)) / (t.ct + d) : NaN;
  }
  const b = t.strong ? 1 : 1 / (1 + kw / 10 ** -t.pk / h);
  return t.ct - d > 0 ? (t.v * (b * t.c + d)) / (t.ct - d) : NaN;
}
// 教科書の近似式。領域 region: 'start'(滴定前)・'buffer'(弱酸・弱塩基の当量点前)・'before'(強酸・強塩基の当量点前)・'eq'・'after'
// f は式の名前(画面で式の文字に置き換える)。pKw = 14.00
export function titrationApprox(t, V, kw = KW) {
  const veq = titrEqVol(t), pkw = -Math.log10(kw), lg = Math.log10;
  const p = t.base ? x => pkw - x : x => x; // 塩基は pOH で計算して pH に直す
  const eqTol = veq * 1e-9;
  if (V <= 0) return t.strong ? { region: 'start', f: 'strong0', ph: p(-lg(t.c)) } : { region: 'start', f: 'weak0', ph: p((t.pk - lg(t.c)) / 2) };
  if (V < veq - eqTol) {
    if (t.strong) return { region: 'before', f: 'strongBefore', ph: p(-lg((t.c * t.v - t.ct * V) / (t.v + V))) };
    return { region: 'buffer', f: 'hh', ph: p(t.pk + lg(V / (veq - V))) };
  }
  if (V <= veq + eqTol) {
    if (t.strong) return { region: 'eq', f: 'strongEq', ph: pkw / 2 };
    const cs = (t.c * t.v) / (t.v + veq); // 当量点の共役塩基(共役酸)の濃度
    return { region: 'eq', f: 'weakEq', ph: p(pkw - (pkw - t.pk - lg(cs)) / 2) };
  }
  return { region: 'after', f: 'after', ph: pkw - p(-lg((t.ct * (V - veq)) / (t.v + V))) };
}
// 指示薬の変色域(pH)。変色域の中央で滴定を止めたときの終点の誤差 (V終点 − V当量点)/V当量点 を % で
export const INDICATORS = [['mo', 3.1, 4.4], ['mr', 4.2, 6.2], ['btb', 6.0, 7.6], ['pp', 8.0, 9.8]];
export function indicatorErrors(t, kw = KW) {
  const veq = titrEqVol(t);
  return INDICATORS.map(([id, lo, hi]) => {
    const v = titrationVol(t, (lo + hi) / 2, kw);
    return { id, lo, hi, err: Number.isFinite(v) && v >= 0 ? (100 * (v - veq)) / veq : NaN, before: v < 0 };
  });
}
// 終点の誤差が最も小さい指示薬
export const bestIndicator = list => list.filter(x => Number.isFinite(x.err)).reduce((a, b) => (!a || Math.abs(b.err) < Math.abs(a.err) ? b : a), null);
