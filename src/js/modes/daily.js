// 今日の1問：日付ごとに決まった1問(同じ日なら誰でも同じ問題)
const dayKey = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD(端末の日付)

// 日付の文字列から、問題を選ぶための数をつくる(隣り合う日でも分野がばらけるよう、よくかき混ぜる)
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

export default {
  id: 'daily',
  label: { ja: '今日の1問', en: 'Question of the day', zh: '每日一题' },
  desc: { ja: '毎日1問、その日の問題を出します。続けて解くと連続学習日数が伸びます', en: 'One question a day. Keep it up to grow your streak', zh: '每天一道题。坚持作答，连续学习天数就会增加' },
  order: 0,
  scope: ['top'],
  feedback: 'instant',
  pick: pool => {
    const list = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
    return list.length ? [list[hash(dayKey()) % list.length]] : [];
  },
};
