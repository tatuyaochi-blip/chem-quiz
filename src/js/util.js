// DOMに依存しない共通関数（build.js からも読み込まれる）

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sample = (list, n) => shuffle(list).slice(0, n);

// 誤り報告フォームのURL: テンプレートの {id}(問題ID) {lang}(言語) {cat}(分野ID) を埋める
export const reportUrl = (tpl, id, lang, cat = '') =>
  tpl.replace('{id}', encodeURIComponent(id)).replace('{lang}', encodeURIComponent(lang)).replace('{cat}', encodeURIComponent(cat));

// 用語集の語から検索用の正規表現を作る。terms: [{ id, term }]
// 「SiC(炭化ケイ素)」は「SiC(炭化ケイ素)」「SiC」「炭化ケイ素」のどれにも一致させる
export function termMatcher(terms) {
  const keys = new Map();
  // 大文字だけの略語(FIT、CMOS など)は大文字のときだけ一致させる(英語の動詞 fit などに一致させない)
  const exact = new Map();
  for (const { id, term, aliases = [] } of terms) {
    const m = term.match(/^(.*?)\s*[(（](.+?)[)）]/);
    for (const k0 of [term, ...(m ? [m[1], m[2]] : []), ...aliases]) {
      // 英数字と漢字・かなの間の空白はあってもなくても一致させる(「功率 MOSFET」と「功率MOSFET」)
      const k1 = k0.trim();
      for (const k of new Set([k1, k1.replace(/(?<=[A-Za-z0-9])\s+(?=[^\x00-\x7F])|(?<=[^\x00-\x7F])\s+(?=[A-Za-z0-9])/g, '')])) {
        const key = k.toLowerCase();
        if (key.length < 2 || keys.has(key)) continue;
        keys.set(key, id);
        if (/^[A-Z0-9][A-Z0-9⁰¹²³⁴⁵⁶⁷⁸⁹-]*$/.test(k) && /[A-Z]/.test(k)) exact.set(key, k);
      }
    }
  }
  // 英字・数字の境界(「CMOS」を「CMOSFET」の中で一致させない)と、カタカナだけの語の境界(「ジクロロシラン」の中の
  // 「シラン」に一致させない)は、linkTerms で一致のあとに確かめる。正規表現の各語に境界の条件を付けると、数千語の
  // 選択肢の速い探し方が使えなくなり、100倍以上遅くなるため。日本語の語は「投影飛程Rp」「理想係数n」のように英字が続いても一致させる
  const sorted = [...keys.keys()].sort((a, b) => b.length - a.length);
  const escape = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // カタカナだけの語が境界で外れた位置で、同じ位置から始まるほかの語を長い順に探し直すための、先頭の文字ごとの一覧
  const byFirst = new Map();
  for (const k of sorted) (byFirst.get(k[0]) ?? byFirst.set(k[0], []).get(k[0])).push(k);
  return { keys, exact, byFirst, re: sorted.length ? new RegExp(`(${sorted.map(escape).join('|')})`, 'gi') : /(?!)/g };
}

const KATA_ONLY = /^[ァ-ヶー・]+$/;
const KATA = /[ァ-ヶー]/;
// カタカナだけの語が、前後にカタカナが続く位置(長いカタカナ語の一部)にないか
const kataBounded = (text, start, end) => !KATA_ONLY.test(text.slice(start, end))
  || !(KATA.test(text[start - 1] ?? '') || KATA.test(text[end] ?? ''));

const ALNUM = /[A-Za-z0-9]/;
const bounded = (text, start, end) => !(ALNUM.test(text[start] ?? '') && ALNUM.test(text[start - 1] ?? ''))
  && !(ALNUM.test(text[end - 1] ?? '') && ALNUM.test(text[end] ?? ''));

// 同じ略語の別の意味。「HBM(人体モデル)」は静電気試験のモデルで、メモリのHBMではない
const OTHER_MEANING = /^\s*[(（]\s*(人体|人體|인체|human body|modèle du corps)/i;

// 文章を [文字列 | { text, id }] に分ける。各用語は最初の1回だけ
// skip: リンクしない用語の id の集合(用語集の noLinkIn で、別の意味で使う分野の問題を除く)
export function linkTerms(text, { keys, exact, byFirst, re }, skip) {
  const parts = [];
  const used = new Set();
  let last = 0;
  re.lastIndex = 0;
  for (let m; (m = re.exec(text));) {
    // カタカナだけの語が長いカタカナ語の一部なら、同じ位置から始まるほかの語を長い順に探す(なければ次の文字から)
    if (!kataBounded(text, m.index, m.index + m[0].length)) {
      const i = m.index;
      const k = (byFirst.get(text[i].toLowerCase()) ?? []).find(w => text.slice(i, i + w.length).toLowerCase() === w && kataBounded(text, i, i + w.length));
      if (!k) { re.lastIndex = i + 1; continue; }
      m = Object.assign([text.slice(i, i + k.length)], { index: i });
      re.lastIndex = i + k.length;
    }
    // 英数字の途中で切れている一致は捨て、次の文字から探し直す
    if (!bounded(text, m.index, m.index + m[0].length)) { re.lastIndex = m.index + 1; continue; }
    if (exact?.has(m[0].toLowerCase()) && exact.get(m[0].toLowerCase()) !== m[0]) continue;
    const id = keys.get(m[0].toLowerCase());
    // ハイフンでつながった別の略語の一部(「ICP-MS」の中の「ICP」など)はリンクしない。「SiC-based」「GPIO-Pins」「MEMS-Gyroskop」は対象
    const end = m.index + m[0].length;
    const acronym = /^[A-Z0-9]+$/.test(m[0]);
    if (used.has(id) || skip?.has(id) || (acronym && (/^-[A-Z0-9]{2,}(?![a-z])/.test(text.slice(end, end + 12))
      || /(?:^|[^A-Za-z0-9])[A-Z0-9]{2,}-$/.test(text.slice(Math.max(0, m.index - 12), m.index))
      || OTHER_MEANING.test(text.slice(end, end + 24))))) continue;
    used.add(id);
    parts.push(text.slice(last, m.index), { text: m[0], id });
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.filter(p => p !== '');
}
