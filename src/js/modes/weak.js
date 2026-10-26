// 苦手問題：直近で間違えた問題を出題（分野ページからは、その分野だけ）
import { shuffle } from '../util.js';

export default {
  id: 'weak',
  label: { ja: '苦手問題', en: 'Weak questions', zh: '错题练习' },
  desc: { ja: '直近で間違えた問題だけを解き直します', en: 'Retry only the questions you last got wrong', zh: '只重做最近答错的题目' },
  order: 3,
  scope: ['top', 'category'],
  feedback: 'instant',
  cats: (params, index) => (params.c ? [params.c] : index.categories.map(c => c.id)),
  pick: (pool, params, { store }) => shuffle(pool.filter(q => store.isWeak(q.id))),
  empty: {
    ja: 'いま苦手な問題はありません。ほかのモードで問題を解いてみましょう。',
    en: 'You have no weak questions right now. Try another mode first.',
    zh: '目前没有错题。请先用其他模式答题吧。',
  },
};
