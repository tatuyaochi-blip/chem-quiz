// 問題の中身の機械的な検査(validate.js の形式の検査を補う)。単体実行: node tools/check-content.js [--strict]
// - 翻訳の数値: 日本語の選択肢にある数値(小数か 10 より大きい数)が、各言語の訳の選択肢にもあるか
// - 小数点の書き方: ドイツ語・オランダ語・フランス語・スペイン語・ポルトガル語で「3,000」のように、桁区切りのつもりが小数に読める書き方がないか
// - 正解と解説: 正解の選択肢が数値なら、その数値が解説(か正解の補足)に出てくるか
// - 選択肢を順番で指す解説: 選択肢は並べ替えて出すので「1番目の選択肢」などは画面と合わない
// - 正解だけが長い選択肢: 正解がほかの選択肢より目立って長いと、読まずに当てられる
// - 正解の長さの順位の偏り: サイト全体で、正解が最長・中間・最短のどれかに偏っていないか
// - 正解の位置の偏り: 分野ごとに、正解が同じ位置に偏っていないか
// - 修正の記録(data/audit-log.json): 問題IDと日付と書式
// 結果は「注意」として出す。--strict のときは注意が1件でもあれば終了コード1
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const readJSON = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const exists = p => fs.existsSync(path.join(root, p));

// 「万・億」や million / Milliarden などの単位語も数に直す(billion は言語で大きさが違う)
const MULT = { 万: 1e4, 億: 1e8, 兆: 1e12, 萬: 1e4, 만: 1e4, 억: 1e8, 조: 1e12, million: 1e6, millions: 1e6, millionen: 1e6, millón: 1e6, millones: 1e6, milhão: 1e6, milhões: 1e6, bilhão: 1e9, bilhões: 1e9, billón: 1e12, billones: 1e12, miljoen: 1e6, miljard: 1e9, milliarde: 1e9, milliarden: 1e9, milliard: 1e9, milliards: 1e9, biljoen: 1e12, trillion: 1e12 };
const DOT_DECIMAL = /(?<![\w.,/])\d+\.\d+(?:[\s-]?(?:%|°|℃|λ|×|wt%|at%|ppm|ppb|ppt|dB[a-zµ]*|[pnµumkMGT]?(?:m|V|A|Ω|eV|Hz|W|F|H|s|Pa|J|g|K|N|bit|B)(?![A-Za-z]))|-?[Ff]ach|\s(?:bis|à|tot|und|et|en|oder|ou|of|fois|keer|mal|a|y|o|e|veces|vezes)\s)/g;
const BILLION = { en: 1e9, de: 1e12, fr: 1e12, es: 1e12, pt: 1e9 };

// 文字列から数値を取り出す。decimalComma の言語では「,」が小数点、「.」と空白が桁区切り
export function numbers(text, lang = 'ja') {
  const decimalComma = ['de', 'nl', 'fr', 'es', 'pt'].includes(lang);
  // 「7億5000万」「1万3,000」のような日本語の数は1つの数にまとめる
  const s = String(text ?? '').normalize('NFKC').replace(/\u2212/g, '-')
    .replace(/(\d+(?:\.\d+)?)億(?:(\d+(?:,\d{3})*)万)?(\d+(?:,\d{3})*)?(?![\d万])/g, (_, a, b = '0', c = '0') => String(a * 1e8 + b.replace(/,/g, '') * 1e4 + +c.replace(/,/g, '')))
    .replace(/(\d+(?:\.\d+)?)\s*[万萬만]\s*(\d+)\s*[千천]/g, (_, a, b) => String(a * 1e4 + b * 1e3))
    .replace(/(\d+(?:\.\d+)?)万(\d+(?:,\d{3})*)(?![\d万億])/g, (_, a, b) => String(a * 1e4 + +b.replace(/,/g, '')))
    .replace(/(\d+(?:\.\d+)?)百万/g, (_, a) => String(a * 1e6))
    // IPv4 のアドレスとマスク(192.168.1.10)は数ではない。点を桁区切りとする言語で別の数に読めてしまうため、どの言語でも除く
    .replace(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g, ' ');
  const out = [];
  for (const m of s.matchAll(/(\d+(?:[.,\u202f\u00a0 ]\d+)*)\s*(万|億|兆|萬|만|억|조|[A-Za-zÀ-ÖØ-öø-ÿ]+)?/g)) {
    let t = m[1];
    t = decimalComma ? t.replace(/[.\u202f\u00a0 ](?=\d{3}(?!\d))/g, '').replace(',', '.') : t.replace(/[,\u202f\u00a0 ](?=\d{3}(?!\d))/g, '');
    if (/[\s\u202f\u00a0]/.test(t)) continue; // 数の並び(「1 2 3」など)は対象外
    const w = m[2]?.toLowerCase();
    const v = parseFloat(t) * (w === 'billion' || w === 'billionen' ? BILLION[lang] ?? 1e9 : MULT[w] ?? 1);
    if (Number.isFinite(v)) out.push(+v.toPrecision(12));
  }
  return out;
}
const significant = v => !(Number.isInteger(v) && Math.abs(v) <= 10);

export function checkContent() {
  const warnings = [];
  const config = readJSON('config.json');
  const langs = config.languages.map(l => l.code).slice(1);
  const commaLangs = new Set(['de', 'nl', 'fr', 'es', 'pt']);
  const cats = readJSON('data/categories.json').map(c => c.id);
  const ids = new Set();
  let total = 0;
  // 確認したうえで問題ないとした項目: data/qa-ignore.json の [{ "id", "check", "lang"?, "reason" }]
  const ignore = exists('data/qa-ignore.json') ? readJSON('data/qa-ignore.json') : [];
  const ignored = (id, check, lang) => ignore.some(x => x.id === id && x.check === check && (!x.lang || x.lang === lang));

  // 言語ごとに、正解が3つの選択肢の中で最長・中間・最短のどれだったかを数える(長さがすべて違い、文になっている問題だけ)
  const rank = new Map([null, ...langs].map(l => [l, [0, 0, 0]]));
  for (const cat of cats) {
    const qs = readJSON(`data/questions/${cat}.json`);
    const tr = Object.fromEntries(langs.map(l => [l, exists(`data/i18n/${l}/questions/${cat}.json`) ? readJSON(`data/i18n/${l}/questions/${cat}.json`) : {}]));
    const pos = [0, 0, 0];
    for (const q of qs) {
      ids.add(q.id);
      total++;
      pos[q.answer] = (pos[q.answer] ?? 0) + 1;
      // 正解が数値の選択肢なら、その数値を解説で説明しているはず
      const ans = numbers(q.choices[q.answer]).filter(significant);
      const ex = numbers(`${q.explanation} ${q.choiceNotes?.[q.answer] ?? ''}`);
      const near = v => ex.some(x => Math.abs(x - v) <= Math.abs(v) * 0.06);
      if (ans.length && !ignored(q.id, 'answer-number') && !ans.some(near)) warnings.push(`${q.id}: 正解「${q.choices[q.answer]}」の数値が解説に出てきません`);
      // 選択肢は出題のたびに並べ替わるので、解説で「1番目の選択肢」「first choice」のように順番で指すと画面と合わない
      // 韓国語(첫 번째 선택지・선택지 2)、ドイツ語(erste Antwort・Option B)、スペイン語(primera opción・opción 2)、ポルトガル語(primeira alternativa・opção B)も見る
      const ORDINAL = /(?:[1-3１-３一二三]|最初|最後)(?:番目|つ[目め])?の選択肢|[1-3１-３]つ[目め](?:は|も)|選択肢\s*[1-3１-３]|(?:first|second|third|last|1st|2nd|3rd) (?:choice|option|answer)|(?:choice|option) [1-3A-C]\b|第\s*[1-3一二三]\s*個?選項|選項\s*[1-3一二三]|(?:첫|두|세|마지막|[1-3]) ?번째 (?:선택지|보기|답)|(?:선택지|보기) ?[1-3]\b(?![,.]\d)|(?:erste|zweite|dritte|letzte)[nrs]? (?:Antwort|Option|Auswahl|Wahlmöglichkeit|Antwortmöglichkeit)|(?:Antwort|Option|Auswahl) [1-3A-C]\b(?![,.]\d)|(?:primer|primera|segund[ao]|tercer|tercera|últim[ao]|primeir[ao]) (?:opción|opção|respuesta|resposta|alternativa)|(?:opción|opção|alternativa|respuesta|resposta) [1-3A-C]\b(?![,.]\d)/i;
      const ordText = l => (l ? [tr[l][q.id]?.explanation, ...(tr[l][q.id]?.choiceNotes ?? [])] : [q.explanation, ...(q.choiceNotes ?? [])]).filter(Boolean).join('\n');
      for (const l of [null, ...langs]) if (ORDINAL.test(ordText(l)) && !ignored(q.id, 'ordinal', l ?? undefined)) warnings.push(`${q.id}${l ? ` [${l}]` : ''}: 解説が選択肢を順番で指しています(選択肢は並べ替えて出すので、中身で指す)`);
      // 正解だけが目立って長い選択肢は、読まなくても当てられる手がかりになる(ほかの選択肢のいちばん長いものの1.5倍以上で、差も大きいもの)
      for (const l of [null, ...langs]) {
        const ch = l ? tr[l][q.id]?.choices : q.choices;
        if (!ch || ignored(q.id, 'choice-length', l ?? undefined)) continue;
        const len = ch.map(c => [...String(c)].length), other = Math.max(...len.filter((_, i) => i !== q.answer));
        const gap = ['ja', 'zh-hant', 'zh', 'ko', null].includes(l) ? 8 : 15;
        if (len[q.answer] >= other * 1.5 && len[q.answer] - other >= gap) warnings.push(`${q.id}${l ? ` [${l}]` : ''}: 正解の選択肢だけが目立って長い(${len[q.answer]}字、ほかは最長${other}字)。誤りの選択肢も具体的にして長さをそろえる`);
        if (len.length === 3 && new Set(len).size === 3 && Math.max(...len) >= (gap === 8 ? 12 : 30)) {
          const lower = len.filter(x => x < len[q.answer]).length;
          rank.get(l)[2 - lower]++;
        }
      }
      for (const l of langs) {
        const t = tr[l][q.id];
        if (!t) continue;
        q.choices.forEach((c, i) => {
          const got = new Set(numbers(t.choices?.[i], l));
          const miss = numbers(c).filter(significant).filter(v => !got.has(v));
          if (miss.length && !ignored(q.id, 'choice-number', l)) warnings.push(`${q.id} [${l}] 選択肢${i + 1}: 日本語の数値 ${miss.join(', ')} が訳にありません(「${t.choices?.[i]}」)`);
        });
        // 小数点がコンマの言語で「3,000」と書くと、3.000(小数)と読める
        if (commaLangs.has(l)) {
          const all = [t.question, ...(t.choices ?? []), t.explanation, ...(t.choiceNotes ?? [])].filter(Boolean).join('\n');
          // 日本語で小数(32.768 など)なら正しい。日本語で整数(3,000 / 3000)なら桁区切りの書き間違い
          const ja = new Set(numbers([q.question, ...q.choices, q.explanation, ...(q.choiceNotes ?? [])].join('\n')));
          for (const m of all.matchAll(/(?<![\d.,])[1-9]\d{0,2},\d{3}(?![\d,])/g)) {
            const asInt = Number(m[0].replace(',', '')), asDec = Number(m[0].replace(',', '.'));
            // 日本語に小数として出てこない「n,nnn」は、整数を桁区切りで書いた疑い(日本語が「10万」のように書いているときも見つける)
            if (!ja.has(asDec)) warnings.push(`${q.id} [${l}]: 「${m[0]}」は ${asDec} と読めます(整数の ${asInt} なら桁区切りを外してください)`);
          }
          // 逆向きの書き間違い: 単位の付いた小数を「0.1 nm」のように点で書いている(この言語では「0,1 nm」)。版番号(PCIe 4.0 など)は単位が付かないので対象外
          // 単位のない小数(「0.35/BW」「−6.25」)も調べる。版番号・規格名(PCIe 3.0、2.5D)、指数表記(1.0e16)、
          // プログラムのコードとして書いた式は対象外で、コードの式は data/qa-ignore.json に check: "dot-decimal" で登録する
          const thousands = n => /^[1-9]\d{0,2}\.\d{3}$/.test(n) && ja.has(Number(n.replace('.', '')));
          const seen = new Set();
          // 版番号: 規格名のすぐ後ろの数、または規格の話をしている文の「n.0」
          const version = (i, n = all.slice(i).match(/\d+\.\d+/)?.[0] ?? '') => /(?:PCIe|PCI Express|USB|UCIe|CXL|TPM|IEEE|TLS|SSL|HTTP|OAuth|[Vv]ersion|Gen)[\s-]*$/.test(all.slice(Math.max(0, i - 16), i))
            || /\.0$/.test(n) && /PCIe|PCI Express|USB|UCIe|CXL|GT\/s/.test(all);
          for (const m of all.matchAll(DOT_DECIMAL)) {
            // 「1.000 µA」のように点が桁区切り(日本語では 1000)なら正しい。「0.001」は桁区切りではない
            const n = m[0].match(/\d+\.\d+/)[0];
            seen.add(m.index + m[0].indexOf(n));
            if (thousands(n) || version(m.index)) continue;
            warnings.push(`${q.id} [${l}]: 「${m[0].trim()}」は小数点をコンマにしてください`);
          }
          if (!ignored(q.id, 'dot-decimal', l)) for (const m of all.matchAll(/(?<![\w.,\/])\d+\.\d+(?![\d.]|e[+-]?\d|D\b)/g)) {
            if (seen.has(m.index) || thousands(m[0]) || version(m.index, m[0])) continue;
            warnings.push(`${q.id} [${l}]: 「${m[0]}」は小数点をコンマにしてください(コードや版番号なら qa-ignore に登録)`);
          }
        }
      }
    }
    const n = qs.length, max = Math.max(...pos);
    if (n >= 20 && max / n > 0.5) warnings.push(`${cat}: 正解の位置が偏っています(${pos.join(' / ')})`);
  }

  // 正解がいつも最長(または中間・最短)だと、読まずに長さで当てられる。偶然なら3分の1ずつ
  for (const [l, c] of rank) {
    const n = c[0] + c[1] + c[2];
    if (n >= 60 && Math.max(...c) / n > 0.5) warnings.push(`サイト全体${l ? ` [${l}]` : ''}: 正解の長さの順位が偏っています(最長 ${c[0]} / 中間 ${c[1]} / 最短 ${c[2]})。誤りの選択肢を具体的にしてばらけさせる`);
  }

  // 用語集・比較ページなど問題以外の訳も、小数点がコンマの言語で点を使っていないか確かめる。
  // 「1.000 °C」のような3桁の桁区切りと、版番号(PCIe などの規格の話で「4.0 à 16 GT/s」のように並ぶもの)は対象外
  for (const l of commaLangs) {
    for (const f of ['glossary', 'compare', 'news-terms', 'careers', 'categories']) {
      const file = `data/i18n/${l}/${f}.json`;
      if (!exists(file)) continue;
      const walk = (v, where) => {
        if (typeof v === 'string') {
          for (const m of v.matchAll(DOT_DECIMAL)) {
            const n = m[0].match(/\d+\.\d+/)[0];
            if (/\.\d{3}$/.test(n) || /\.0$/.test(n) && /PCIe|PCI Express|USB|UCIe|CXL|[Vv]ersion|GT\/s/.test(v)) continue;
            warnings.push(`${file} ${where}: 「${m[0].trim()}」は小数点をコンマにしてください`);
          }
        } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where ? `${where}/${k}` : k);
      };
      walk(readJSON(file), '');
    }
  }

  // 修正の記録: { "問題ID": [{ "date": "YYYY-MM-DD", "type": "fix|verify", "summary": "...", "sources": [...] }] }
  if (exists('data/audit-log.json')) {
    const log = readJSON('data/audit-log.json');
    for (const [id, entries] of Object.entries(log)) {
      if (!ids.has(id)) warnings.push(`audit-log.json: 問題 ${id} がありません`);
      for (const e of Array.isArray(entries) ? entries : [entries]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? '')) warnings.push(`audit-log.json: ${id} の date は YYYY-MM-DD にしてください`);
        if (!['fix', 'verify'].includes(e?.type)) warnings.push(`audit-log.json: ${id} の type は fix か verify にしてください`);
        if (!e?.summary) warnings.push(`audit-log.json: ${id} に summary がありません`);
        if (e?.sources && !Array.isArray(e.sources)) warnings.push(`audit-log.json: ${id} の sources は配列にしてください`);
      }
    }
  }
  return { warnings, total };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { warnings, total } = checkContent();
  warnings.forEach(w => console.log(`注意: ${w}`));
  console.log(`${warnings.length ? 'NG' : 'OK'}: 問題 ${total} 問を検査、注意 ${warnings.length} 件`);
  if (process.argv.includes('--strict') && warnings.length) process.exit(1);
}
