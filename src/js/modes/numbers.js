// 数値の感覚: 「Numbers Every Chip Engineer Should Know」の数値に関係する問題から10問
// (問題IDの一覧は build.js が index.json の numbersQ に入れる)
import { sample } from '../util.js';

export default {
  id: 'numbers',
  label: { ja: '覚えておきたい数値', en: 'Key numbers drill', zh: '必记数值' },
  desc: { ja: '技術者が桁を覚えておきたい数値の問題から10問', en: 'Ten questions on the numbers every chip engineer should know', zh: '从工程师必记数值的题目中抽取10题' },
  order: 8,
  scope: [],                    // トップ・分野ページには出さない(Numbers ページから開く)
  feedback: 'instant',
  cats: (params, index) => [...new Set((index.numbersQ ?? []).map(id => id.replace(/-\d+$/, '')))],
  pick: (pool, params, { index }) => sample(pool.filter(q => (index.numbersQ ?? []).includes(q.id)), 10),
};
