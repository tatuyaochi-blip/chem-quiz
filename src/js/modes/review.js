// 復習：間隔反復(ライトナー方式)で、今日出す日になった問題をすべて出題
import { shuffle } from '../util.js';

export default {
  id: 'review',
  label: { ja: '今日の復習', en: "Today's review", zh: '今日复习' },
  desc: { ja: '解いた問題を、忘れかけたころにもう一度出題します', en: 'Questions you have answered come back just as you start to forget them', zh: '在快要遗忘时再次出题' },
  order: 5,
  scope: ['top'],
  feedback: 'instant',
  pick: (pool, params, { store }) => shuffle(pool.filter(q => store.isDue(q.id))),
  empty: {
    ja: '今日の復習はありません。新しい問題を解くと、日をおいてここに出てきます。',
    en: 'No reviews for today. Questions you answer will come back here after a few days.',
    zh: '今天没有需要复习的题目。',
  },
};
