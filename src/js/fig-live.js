// 操作できる図解。静的な図(SVG)と説明はそのまま残し、その下の [data-fig-live] に、スライダーで動かせる図を描く。
// 文言は data-text(JSON)、計算ツールへのリンクは [data-tool-link](今の値をクエリに付ける)
const lang = document.documentElement.lang || 'en';
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toLocaleString(lang, { maximumSignificantDigits: d }) : '–');
const sup = n => String(n).replace(/[-\d]/g, c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
const pow10 = x => { const e = Math.floor(Math.log10(x) + 1e-9), m = Number((x / 10 ** e).toPrecision(2)); return m === 1 ? `10${sup(e)}` : `${fmt(m, 2)}×10${sup(e)}`; };
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// SVGの文字。cls は図のクラス(sm・m・a など)
const text = (x, y, s, cls = '', anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}"${cls ? ` class="${cls}"` : ''}>${escText(s)}</text>`;

const q = 1.602e-19, kT = 0.02585, e0 = 8.854e-14;

// ---- PN接合の空乏層: 逆バイアスで空乏層が広がる(Si、NA = 10¹⁷、ND = 10¹⁶ cm⁻³。PN接合の計算ツールの既定値) ----
function pnDepletion(v, t) {
  const NA = 1e17, ND = 1e16, ni = 1e10, es = 11.7 * e0;
  const vbi = kT * Math.log((NA * ND) / (ni * ni));
  const vr = v.vr;
  const W = Math.sqrt(((2 * es * (vbi + vr)) / q) * (1 / NA + 1 / ND)) * 1e4; // µm
  const xn = (W * NA) / (NA + ND), xp = W - xn;
  const emax = (2 * (vbi + vr)) / (W * 1e-4) / 1e3; // kV/cm
  // 横は 1 µm = 160 px(接合は x = 300)。広がりすぎたら端で止める
  const S = 160, J = 300, L = 60, R = 540;
  const left = Math.max(J - xp * S, L), right = Math.min(J + xn * S, R);
  const ions = [];
  for (let x = right - 12; x > J + 4; x -= 24) ions.push(text(x, 82, '+', 'm'), text(x, 112, '+', 'm'));
  for (let x = left + 8; x < J - 4; x += 12) ions.push(text(x, 82, '−', 'm'), text(x, 112, '−', 'm'));
  const holes = [90, 130, 170, 210, 250].filter(x => x < left - 8).map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 80 : 108}" r="6" class="hole"/>`);
  const elec = [330, 370, 410, 450, 490, 520].filter(x => x > right + 8).map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 80 : 108}" r="5" class="fa"/>`);
  const svg = `<svg viewBox="0 0 600 200" role="img" aria-label="${escText(t.svg_label)}">
<rect x="${L}" y="60" width="${J - L}" height="64" class="p"/><rect x="${J}" y="60" width="${R - J}" height="64" class="n"/>
<rect x="${left}" y="60" width="${right - left}" height="64" class="dep"/>
${ions.join('')}${holes.join('')}${elec.join('')}
${text(L + 26, 50, t.p, 'sm', 'middle')}${text(R - 26, 50, t.n, 'sm', 'middle')}
<line x1="${left}" y1="138" x2="${right}" y2="138" class="thin"/><line x1="${left}" y1="132" x2="${left}" y2="144" class="thin"/><line x1="${right}" y1="132" x2="${right}" y2="144" class="thin"/>
${text((left + right) / 2, 160, fill(t.w_label, { w: fmt(W) }), 'sm a')}
${text(300, 186, fill(t.split, { xp: fmt(xp), xn: fmt(xn) }), 'sm m')}
</svg>`;
  return {
    svg,
    state: fill(vr < 0 ? t.state_fwd : vr === 0 ? t.state_zero : t.state_rev, { vr: fmt(Math.abs(vr)), w: fmt(W), emax: fmt(emax) }),
    query: { mat: 'si', na: '1e17', nd: '1e16', vr },
    value: { vr: `${fmt(vr, 2)} V` },
  };
}

// ---- n型半導体のバンド図: ドナー濃度でフェルミ準位が伝導帯へ近づく(Si、300 K) ----
function bandNType(v, t) {
  const Eg = 1.12, ni = 1e10, ND = 10 ** v.logn;
  const dEF = kT * Math.log(ND / ni); // EF − Ei
  const ecEF = Eg / 2 - dEF;
  const top = 50, bot = 230, mid = (top + bot) / 2; // Ec と Ev の位置
  const Y = e => mid - (e / Eg) * (bot - top); // Ei からのエネルギー (eV) → y
  const yF = Y(dEF);
  const n = Math.max(1, Math.min(8, Math.round(Math.log10(ND) - 12))); // 伝導帯の電子の数(表示用)
  const elec = Array.from({ length: n }, (_, i) => `<circle cx="${80 + i * 26}" cy="${top - 10}" r="4.5" class="fa"/>`).join('');
  const svg = `<svg viewBox="0 0 600 270" role="img" aria-label="${escText(t.svg_label)}">
<rect x="50" y="${top - 30}" width="260" height="30" class="band"/>${elec}
<line x1="50" y1="${top}" x2="310" y2="${top}" class="ln"/>${text(320, top + 5, 'Ec', '', 'start')}
<line x1="50" y1="${mid}" x2="310" y2="${mid}" class="dash"/>${text(320, mid + 5, t.ei, 'm', 'start')}
<line x1="50" y1="${yF}" x2="310" y2="${yF}" class="ac"/>${text(320, yF + 5, t.ef, 'a', 'start')}
<line x1="50" y1="${bot}" x2="310" y2="${bot}" class="ln"/>${text(320, bot + 5, 'Ev', '', 'start')}
<rect x="50" y="${bot}" width="260" height="30" class="band"/>
<line x1="34" y1="${top}" x2="34" y2="${yF}" class="thin"/>${text(30, (top + yF) / 2 + 5, `${fmt(ecEF)} eV`, 'sm', 'end')}
</svg>`;
  return {
    svg,
    state: fill(t.state, { nd: pow10(ND), def: fmt(dEF), ecef: fmt(ecEF) }),
    query: { type: 'n', n: ND.toExponential(2).replace('e+', 'e') },
    value: { logn: `${pow10(ND)} cm⁻³` },
  };
}

// ---- CMOSインバータ: 入力電圧で各トランジスタのオン/オフと出力が変わる(長チャネルの2乗則、VDD = 1.2 V、|Vth| = 0.35 V、βn = βp) ----
const VDD = 1.2, VT = 0.35;
// 2乗則の電流(係数は省略)。飽和領域ではチャネル長変調(λ = 0.1 /V)を入れて、入力がちょうど中央のときにも出力が1つに決まるようにする
const ids = (vgs, vds) => (vgs <= VT ? 0 : vds >= vgs - VT ? 0.5 * (vgs - VT) ** 2 * (1 + 0.1 * (vds - (vgs - VT))) : (vgs - VT) * vds - 0.5 * vds * vds);
function vout(vin) {
  // nMOS の電流 = pMOS の電流 となる出力電圧を二分法で求める
  let lo = 0, hi = VDD;
  for (let k = 0; k < 50; k++) {
    const m = (lo + hi) / 2;
    if (ids(vin, m) > ids(VDD - vin, VDD - m)) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}
function cmosInverter(v, t) {
  const vin = v.vin, vo = vout(vin);
  const nOn = vin > VT, pOn = VDD - vin > VT;
  const sw = (on, y) => `<rect x="110" y="${y}" width="80" height="50" class="${on ? (y < 100 ? 'p' : 'n') : 'ok'}"/>${text(150, y + 22, y < 100 ? 'pMOS' : 'nMOS', '')}${text(150, y + 42, on ? t.on : t.off, on ? 'sm a' : 'sm m')}`;
  // 伝達特性(右側): 横 = 入力 0〜VDD、縦 = 出力
  const X = x => 340 + (x / VDD) * 220, Y = y => 230 - (y / VDD) * 168;
  const curve = Array.from({ length: 61 }, (_, i) => (i / 60) * VDD).map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(vout(x)).toFixed(1)}`).join('');
  const svg = `<svg viewBox="0 0 600 280" role="img" aria-label="${escText(t.svg_label)}">
${text(150, 24, 'VDD')}<line x1="150" y1="32" x2="150" y2="60" class="ln"/>
${sw(pOn, 60)}
<line x1="150" y1="110" x2="150" y2="165" class="ln"/><circle cx="150" cy="138" r="4" class="ink"/><line x1="150" y1="138" x2="230" y2="138" class="ln"/>
${text(236, 132, t.out, 'sm', 'start')}${text(236, 152, `${fmt(vo, 2)} V`, 'sm a', 'start')}
${sw(nOn, 165)}
<line x1="150" y1="215" x2="150" y2="240" class="ln"/><line x1="135" y1="240" x2="165" y2="240" class="ln"/><line x1="141" y1="247" x2="159" y2="247" class="ln"/>
<line x1="20" y1="138" x2="85" y2="138" class="ln"/><line x1="85" y1="85" x2="85" y2="190" class="ln"/><line x1="85" y1="85" x2="110" y2="85" class="ln"/><line x1="85" y1="190" x2="110" y2="190" class="ln"/>
${text(20, 128, t.in, 'sm', 'start')}${text(20, 160, `${fmt(vin, 2)} V`, 'sm a', 'start')}
<line x1="340" y1="50" x2="340" y2="230" class="thin"/><line x1="340" y1="230" x2="560" y2="230" class="thin"/>
<path d="${curve}" class="ac"/>
<circle cx="${X(vin)}" cy="${Y(vo)}" r="6" class="fa"/>
${text(450, 256, t.axis_in, 'sm m')}${text(334, 40, t.axis_out, 'sm m', 'start')}
${text(340, 246, '0', 'sm m')}${text(560, 246, fmt(VDD, 2), 'sm m')}
</svg>`;
  const key = nOn && pOn ? 'state_both' : nOn ? 'state_low' : 'state_high';
  return { svg, state: fill(t[key], { vin: fmt(vin, 2), vout: fmt(vo, 2) }), value: { vin: `${fmt(vin, 2)} V` } };
}

// ---- nチャネルMOSFETの断面: ゲート電圧でチャネル(反転層)ができる(しきい値電圧の計算ツールの既定値 Vth ≈ 0.46 V、Wdmax ≈ 0.049 µm) ----
function nmosChannel(v, t) {
  const vth = 0.46, vgs = v.vgs;
  const on = vgs > vth;
  // 空乏層の深さ(表示用): VGS が Vth に近づくまで √ で深くなり、その後は一定
  const vfb = -1.02, dep = vgs <= vfb ? 0 : Math.min(1, Math.sqrt(Math.max(0, vgs - vfb) / (vth - vfb)));
  const inv = on ? Math.min(1, (vgs - vth) / 1.2) : 0;
  const ne = Math.max(2, Math.round(inv * 10));
  const elec = on ? Array.from({ length: ne }, (_, i) => `<circle cx="${200 + (160 / (ne - 1)) * i}" cy="135" r="3.2" class="fa"/>`).join('') : '';
  const svg = `<svg viewBox="0 0 580 250" role="img" aria-label="${escText(t.svg_label)}">
<rect x="40" y="130" width="480" height="110" class="p"/>${text(52, 228, t.sub, '', 'start')}
${dep ? `<rect x="190" y="130" width="180" height="${(dep * 46).toFixed(1)}" class="dep"/>` : ''}
<rect x="70" y="130" width="120" height="50" class="n"/>${text(130, 154, t.source)}${text(130, 172, 'n⁺', 'sm m')}
<rect x="370" y="130" width="120" height="50" class="n"/>${text(430, 154, t.drain)}${text(430, 172, 'n⁺', 'sm m')}
<rect x="190" y="116" width="180" height="14" class="ox"/><rect x="190" y="76" width="180" height="40" class="metal"/>${text(280, 101, t.gate)}
${on ? `<rect x="190" y="131" width="180" height="${(2 + inv * 6).toFixed(1)}" class="fa"/>` : ''}${elec}
${text(280, 62, `VGS = ${fmt(vgs, 2)} V`, on ? 'a' : 'm')}
${dep ? text(280, 196, on ? t.inv : t.dep, on ? 'sm a' : 'sm m') : ''}
</svg>`;
  const key = vgs <= vfb ? 'state_acc' : on ? 'state_on' : 'state_dep';
  return {
    svg,
    state: fill(t[key], { vgs: fmt(vgs, 2), vth: fmt(vth, 2), qn: fmt(0.691 * Math.max(0, vgs - vth), 2) }),
    query: { vth, vgs: Number(vgs.toFixed(2)) },
    value: { vgs: `${fmt(vgs, 2)} V` },
  };
}

// ---- セットアップ/ホールド時間: データの変化のタイミングを動かして違反を判定する(tsu = 0.3 ns、th = 0.2 ns) ----
function setupHold(v, t) {
  const tsu = 0.3, th = 0.2;
  const ta = v.arrive, tc = Math.max(v.change, ta + 0.05);
  const X = s => 300 + s * 200; // エッジ(0 ns)が x = 300、1 ns = 200 px
  const okS = ta <= -tsu + 1e-9, okH = tc >= th - 1e-9;
  const a = X(ta), c = X(tc);
  const svg = `<svg viewBox="0 0 600 230" role="img" aria-label="${escText(t.svg_label)}">
<rect x="${X(-tsu)}" y="36" width="${X(th) - X(-tsu)}" height="118" class="${okS && okH ? 'band' : 'ng'}"/>
${text(20, 66, t.clk, 'sm', 'start')}<path d="M90,48 H${X(-0.8)} V78 H300 V48 H${X(0.8)} V78 H580" class="ln"/>
${text(20, 136, t.data, 'sm', 'start')}
<path d="M90,116 H${a - 8} L${a + 8},146 H${c - 8} L${c + 8},116 H580" class="ln"/>
<path d="M90,146 H${a - 8} L${a + 8},116 H${c - 8} L${c + 8},146 H580" class="ln"/>
<line x1="300" y1="30" x2="300" y2="170" class="dash"/>${text(300, 24, t.edge, 'sm a')}
${text(X(-tsu) - 4, 186, `tsu ${tsu} ns`, 'sm', 'end')}${text(X(th) + 4, 186, `th ${th} ns`, 'sm', 'start')}
${text(300, 214, okS && okH ? t.ok : !okS ? t.ng_setup : t.ng_hold, okS && okH ? 'sm a' : 'sm')}
</svg>`;
  const slackS = -tsu - ta, slackH = tc - th;
  return {
    svg,
    state: fill(t.state, { s: fmt(slackS, 2), h: fmt(slackH, 2), verdict: okS && okH ? t.ok : !okS ? t.ng_setup : t.ng_hold }),
    value: { arrive: `${fmt(ta, 2)} ns`, change: `${fmt(tc, 2)} ns` },
  };
}

const FIGS = { 'pn-depletion': pnDepletion, 'band-n-type': bandNType, 'cmos-inverter': cmosInverter, 'nmos-channel': nmosChannel, 'setup-hold': setupHold };

for (const root of document.querySelectorAll('[data-fig-live]')) {
  const draw = FIGS[root.dataset.figLive];
  if (!draw) continue;
  let t = {};
  try { t = JSON.parse(root.dataset.text); } catch {}
  const inputs = [...root.querySelectorAll('input[type="range"]')];
  const box = root.querySelector('.fig-live-svg'), state = root.querySelector('.fig-live-state'), link = root.querySelector('[data-tool-link]');
  const update = () => {
    const v = Object.fromEntries(inputs.map(el => [el.name, Number(el.value)]));
    const r = draw(v, t);
    box.innerHTML = r.svg;
    state.textContent = r.state;
    for (const el of inputs) { const o = root.querySelector(`output[for="${el.id}"]`); if (o && r.value?.[el.name]) o.textContent = r.value[el.name]; }
    if (link && r.query) link.search = new URLSearchParams(r.query).toString();
  };
  inputs.forEach(el => el.addEventListener('input', update));
  root.hidden = false;
  update();
}
