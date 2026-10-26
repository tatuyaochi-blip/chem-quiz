// 用語の対訳クイズ: 用語集の日本語・英語・繁体字の名前から出題する(?from=ja&to=en なら、日本語を見て英語を選ぶ)。
// 誤りの選択肢は同じ分野の語から選ぶ。問題ファイルではなく用語のデータ(terms.json)から作るので、分野ごとの学習記録には入れない
import { sample } from '../util.js';

// 名前どうしで同じ英字の語(略語など)を共有していると、見ただけで答えがわかるので出さない
const words = s => new Set((s.match(/[A-Za-z][A-Za-z0-9]+/g) ?? []).map(w => w.toLowerCase()));
const giveaway = (a, b) => { const wa = words(a); return [...words(b)].some(w => wa.has(w)); };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

export default {
  id: 'terms',
  label: { ja: '用語の対訳クイズ', en: 'Term translation quiz' },
  desc: { ja: '用語を、日本語・英語・中国語で言えるか確かめる10問', en: 'Ten questions on terms in English, Japanese and Chinese' },
  order: 10,
  scope: [],                    // トップ・分野ページには出さない(対訳表のページから開く)
  feedback: 'instant',
  record: false,
  load: async ({ params, index, getData }) => {
    const Q = index.termQuiz;
    if (!Q) return [];
    const pair = Q.pairs.find(([f, t]) => f === params.from && t === params.to) ?? Q.pairs[0];
    const [from, to] = pair;
    const list = (await getData('terms.json')).filter(x => x.n[from] && x.n[to] && !giveaway(x.n[from], x.n[to]));
    return sample(list, 10).map(x => {
      const same = list.filter(y => y.c === x.c && y.n[to] !== x.n[to]);
      const pool = same.length >= 2 ? same : list.filter(y => y.n[to] !== x.n[to]);
      const wrong = [...new Set(sample(pool, 6).map(y => y.n[to]))].slice(0, 2);
      return {
        id: `term:${x.k}`,
        cat: x.c,
        question: fill(Q.question, { term: x.n[from], lang: Q.langs[to] }),
        choices: [x.n[to], ...wrong],
        answer: 0,
        explanation: `${fill(Q.answer, { a: x.n[from], b: x.n[to], lang: Q.langs[to] })}${x.d}`,
      };
    });
  },
};
