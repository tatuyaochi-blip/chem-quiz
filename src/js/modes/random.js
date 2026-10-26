// ランダム：全分野から10問
import { sample } from '../util.js';

export default {
  id: 'random',
  label: { ja: 'ランダム10問', en: '10 random questions', zh: '随机10题' },
  desc: { ja: '全分野からランダムに10問。すきま時間の腕試しに', en: 'Ten random questions from all topics — a quick check', zh: '从所有领域随机抽取10题，适合利用碎片时间自测' },
  order: 2,
  scope: ['top'],
  feedback: 'instant',
  pick: pool => sample(pool, 10),
};
