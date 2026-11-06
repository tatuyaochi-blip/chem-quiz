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
