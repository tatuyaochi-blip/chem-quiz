// 計算ツールの一覧(/tools/): 上部に「お気に入り」と「最近使ったツール」を出す(このブラウザに保存したものだけ)
import { toolFavs, recentTools } from './store.js';

const root = document.querySelector('[data-tool-mine]');
const card = id => document.querySelector(`.tool-all [data-tool="${CSS.escape(id)}"]`);
function fill(name, ids) {
  const box = root.querySelector(`[data-list="${name}"]`);
  const cards = ids.map(card).filter(Boolean);
  box.querySelector('.mode-grid').replaceChildren(...cards.map(c => c.cloneNode(true)));
  box.hidden = !cards.length;
  return cards.length;
}
if (root) {
  const fav = toolFavs();
  const n = fill('fav', fav) + fill('recent', recentTools().filter(id => !fav.includes(id)));
  root.hidden = !n;
}
