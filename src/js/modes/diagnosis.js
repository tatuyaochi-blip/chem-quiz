// 弱点診断：全分野から1問ずつ出題し、結果画面で苦手な区分・分野を示す(diagnosis.js)
import { shuffle } from '../util.js';

export default {
  id: 'diagnosis',
  label: { ja: '弱点診断', en: 'Weak-spot check', zh: '弱项诊断' },
  desc: { ja: '全分野から1問ずつ出題し、苦手な分野と次に学ぶ分野を案内します', en: 'One question from each topic; shows your weak areas and what to study next', zh: '每个领域出1题，找出薄弱领域并推荐接下来学习的内容' },
  order: 6,
  scope: ['top'],
  feedback: 'end',
  report: 'diagnosis',          // 結果画面に診断結果(区分ごとの正答率・おすすめの分野)を出す
  // 分野ごとに1問。基礎・標準の問題を優先する(応用しかない分野はそこから)
  pick: pool => {
    const byCat = new Map();
    for (const q of pool) byCat.set(q.cat, [...(byCat.get(q.cat) ?? []), q]);
    return shuffle([...byCat.values()].map(list => {
      const easy = list.filter(q => !q.level || q.level <= 2);
      return shuffle(easy.length ? easy : list)[0];
    }));
  },
};
