// 模擬試験：全分野から30問。解説は最後にまとめて表示
import { sample } from '../util.js';

export default {
  id: 'exam',
  label: { ja: '模擬試験（30問）', en: 'Mock exam (30 questions)', zh: '模拟考试（30题）' },
  desc: { ja: '全分野から30問。解説は最後にまとめて表示します', en: '30 questions from all topics; explanations are shown at the end', zh: '从所有领域抽取30题，最后统一显示解析' },
  order: 4,
  scope: ['top'],
  feedback: 'end',
  pick: pool => sample(pool, 30),
};
