// 計算ツールの計算(src/js/chemcalc.js)を、教科書の定番の例とサイトの問題の数値で照らす。ページと同じ関数を読む。
// 期待値は手計算(python3 で別に計算)で出したもの。出典の欄は、その値がどこから来たか。
import * as C from '../src/js/chemcalc.js';

// 滴定の例: 0.100 mol/L 酢酸 25.0 mL を 0.100 mol/L NaOH で、0.100 mol/L アンモニア 25.0 mL を 0.100 mol/L HCl で
const HAc = { base: false, strong: false, c: 0.1, v: 25, pk: 4.76, ct: 0.1 };
const NH3 = { base: true, strong: false, c: 0.1, v: 25, pk: 4.75, ct: 0.1 };

const cases = [
  // [名前, 計算した値, 期待値, 許す相対誤差, 出典]
  ['緩衝液 酢酸 pKa 4.76、[A⁻]=[HA]', C.bufferPH(4.76, 0.10, 0.10), 4.76, 1e-9, 'pH = pKa(比が1)'],
  ['緩衝液 [A⁻]/[HA] = 1.5', C.bufferPH(4.76, 0.10, 0.15), 4.936, 1e-3, '4.76 + log10 1.5'],
  ['緩衝液 目標 pH = pKa + 1 の比', C.bufferMix(4.76, 5.76, 0.2).ratio, 10, 1e-9, '10^(pH − pKa)'],
  ['緩衝液 全濃度 0.2、比1 の A⁻', C.bufferMix(4.76, 4.76, 0.2).a, 0.1, 1e-9, '半分ずつ'],
  ['透過率 10 % → 吸光度', C.absFromT(10), 1, 1e-12, 'A = −log10 T'],
  ['吸光度 2 → 透過率', C.tFromAbs(2), 1, 1e-12, 'T = 10^(−A)'],
  ['ベール A=0.50, ε=1.0×10⁴, l=1 cm', C.beerConc(0.5, 1e4, 1), 5e-5, 1e-12, 'c = A/(εl)'],
  ['保持係数 t0 1.50, tR 6.00', C.retentionFactor(6, 1.5), 3, 1e-12, '問題 chromatography-003'],
  ['理論段数 tR 10.0, W 0.40', C.plates(10, 0.4), 10000, 1e-12, '問題 chromatography-005'],
  ['理論段数(半値幅) tR 8.00, W½ 0.160', C.platesHalf(8, 0.16), 13850, 1e-12, '問題 chromatography-006'],
  ['分離度 8.0/8.6 分、幅 0.40', C.resolution(8, 8.6, 0.4, 0.4), 1.5, 1e-9, '問題 chromatography-007'],
  ['Cl 1個 M+2/M', 100 * C.isotopePattern(1, 0)[1] / C.isotopePattern(1, 0)[0], 32.0, 2e-3, '約 3 : 1(³⁷Cl/³⁵Cl = 24.24/75.76)'],
  ['Cl 2個 M+2/M', 100 * C.isotopePattern(2, 0)[1] / C.isotopePattern(2, 0)[0], 63.99, 1e-3, '約 9 : 6 : 1'],
  ['Cl 2個 M+4/M', 100 * C.isotopePattern(2, 0)[2] / C.isotopePattern(2, 0)[0], 10.24, 1e-3, '約 9 : 6 : 1'],
  ['Br 1個 M+2/M', 100 * C.isotopePattern(0, 1)[1] / C.isotopePattern(0, 1)[0], 97.28, 1e-3, '約 1 : 1'],
  ['Br 2個 M+2 が最大(M/M+2)', 100 * C.isotopePattern(0, 2)[0] / C.isotopePattern(0, 2)[1], 51.40, 1e-3, '約 1 : 2 : 1'],
  ['存在確率の合計 Cl2Br2', C.isotopePattern(2, 2).reduce((a, b) => a + b), 1, 1e-12, '確率の和は1'],
  ['M+1 炭素6個', C.mPlus1(6), 6.489, 1e-3, '6 × 1.07/98.93 × 100'],
  ['1次 半減期 k = 2.31×10⁻⁴ s⁻¹', C.halfLife(1, 1, 2.31e-4), 3000.6, 1e-3, '問題 substitution-elimination-013(約 3.00×10³ s)'],
  ['2次 半減期 k = 0.050, [A]₀ = 0.20', C.halfLife(2, 0.2, 0.05), 100, 1e-12, '問題 kinetics-mechanism-003'],
  ['0次 半減期 [A]₀ = 1.0, k = 0.01', C.halfLife(0, 1, 0.01), 50, 1e-12, '[A]₀/(2k)'],
  ['1次 半減期で濃度が半分', C.conc(1, 1, 0.1, C.halfLife(1, 1, 0.1)), 0.5, 1e-12, '定義'],
  ['2次 半減期で濃度が半分', C.conc(2, 0.2, 0.05, 100), 0.1, 1e-12, '定義'],
  ['0次 濃度は0で止まる', C.conc(0, 1, 0.1, 50), 0, 0, '[A] ≥ 0'],
  ['1次 90 % 反応する時間 k = 0.1', C.t90(1, 1, 0.1), 23.026, 1e-4, 'ln10/k'],
  ['アレニウス 25→35 ℃ で速度2倍の Ea (J/mol)', C.arrhenius(298.15, 1, 308.15, 2).ea, 52946, 1e-4, '定番の「10 ℃で2倍 ≈ 53 kJ/mol」'],
  // 滴定曲線(電荷収支を数値で解いた値。期待値は python3 で電荷収支の3次式を別に解いた値と教科書の値)
  ['滴定 酢酸 0.100 M 25.0 mL(pKa 4.76)の滴定前', C.titrationPH(HAc, 0), 2.883, 2e-4, '教科書 2.88(√(KaC))'],
  ['滴定 酢酸 半当量点 = pKa', C.titrationPH(HAc, 12.5), 4.7605, 1e-4, 'pH = pKa 4.76(電荷収支では 4.7605)'],
  ['滴定 酢酸 当量点(pKa 4.76)', C.titrationPH(HAc, 25), 8.7295, 1e-4, '7 + ½(pKa + log 0.0500) = 8.73'],
  ['滴定 酢酸 当量点(Ka 1.8×10⁻⁵)', C.titrationPH({ ...HAc, pk: -Math.log10(1.8e-5) }, 25), 8.722, 2e-4, '問題 volumetric-006(8.72)'],
  ['滴定 酢酸 当量体積', C.titrEqVol(HAc), 25, 1e-12, 'cV/c_t'],
  ['滴定 酢酸 NaOH 30.0 mL(過剰)', C.titrationPH(HAc, 30), 11.959, 1e-4, '14 + log(0.100×5.0/55.0)'],
  ['滴定 酢酸 の指示薬はフェノールフタレイン', C.bestIndicator(C.indicatorErrors(HAc)).id === 'pp' ? 1 : 0, 1, 0, '問題 volumetric-002'],
  ['滴定 強酸−強塩基 0.100 M の当量点', C.titrationPH({ ...HAc, strong: true }, 25), 7.0, 1e-9, '問題 volumetric-001(7.00)'],
  ['滴定 HCl 0.100 M の滴定前', C.titrationPH({ ...HAc, strong: true }, 0), 1.0, 1e-9, '−log 0.100'],
  ['滴定 HCl 当量点の 0.1 % 前', C.titrationPH({ ...HAc, strong: true }, 24.975), 4.3008, 1e-4, '−log(2.5×10⁻⁶ mol/49.975 mL)'],
  ['滴定 1.0×10⁻⁸ M HCl(水の電離を含む)', C.titrationPH({ ...HAc, strong: true, c: 1e-8 }, 0), 6.978, 1e-4, '公式集 pH の例(約 6.98)'],
  ['滴定 NH3 0.100 M(pKb 4.75)の滴定前', C.titrationPH(NH3, 0), 11.122, 1e-4, '14 − ½(4.75 − log 0.100) = 11.125(近似)'],
  ['滴定 NH3 半当量点 = 14 − pKb', C.titrationPH(NH3, 12.5), 9.2495, 1e-4, 'pKa(NH4⁺) 9.25'],
  ['滴定 NH3 当量点', C.titrationPH(NH3, 25), 5.2755, 1e-4, '½(9.25 − log 0.0500) = 5.28'],
  ['滴定 NH3 の指示薬はメチルレッド', C.bestIndicator(C.indicatorErrors(NH3)).id === 'mr' ? 1 : 0, 1, 0, '問題 volumetric-003'],
  ['滴定 NaOH 0.100 M を HCl で 当量点', C.titrationPH({ ...NH3, strong: true }, 25), 7.0, 1e-9, '強塩基−強酸'],
  ['滴定 pH から体積へ戻す(酢酸 10.0 mL)', C.titrationVol(HAc, C.titrationPH(HAc, 10)), 10, 1e-9, '電荷収支の逆算'],
  ['滴定 近似 酢酸の当量点', C.titrationApprox(HAc, 25).ph, 8.7295, 1e-4, '7 + ½(pKa + log Cs)'],
  ['滴定 近似 NH3 の緩衝域 V = 5.0 mL', C.titrationApprox(NH3, 5).ph, 9.852, 1e-4, '9.25 + log(20.0/5.0)'],
];

let bad = 0;
for (const [name, got, want, tol, src] of cases) {
  const ok = Number.isFinite(got) && (want === 0 ? Math.abs(got) <= tol : Math.abs(got - want) <= Math.abs(want) * tol);
  if (!ok) { bad++; console.error(`NG ${name}: ${got}(期待 ${want}、${src})`); }
}
if (bad) { console.error(`計算ツールのテスト: ${bad} 件が合わない`); process.exit(1); }
console.log(`OK: 計算ツールのテスト ${cases.length} 件`);
