// 問題セット: URL の ids=問題ID,問題ID,… に並べた問題を、その順で出題する(教員・研修向けの「問題セットを作る」ページで発行)。
// &t= でクイズの題名を付けられる
export default {
  id: 'set',
  label: { ja: '問題セット', en: 'Question set', zh: '题目集' },
  desc: { ja: '指定された問題を順に出題します', en: 'The questions chosen for this set, in order', zh: '按顺序出题指定的题目' },
  order: 9,
  scope: [],                    // トップ・分野ページには出さない(発行したURLから開く)
  feedback: 'instant',
  cats: params => [...new Set(String(params.ids ?? '').split(',').filter(Boolean).map(id => id.replace(/-\d+$/, '')))],
  pick: (pool, params) => {
    const byId = new Map(pool.map(q => [q.id, q]));
    return [...new Set(String(params.ids ?? '').split(','))].map(id => byId.get(id)).filter(Boolean);
  },
};
