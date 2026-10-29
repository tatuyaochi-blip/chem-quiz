// 用語集の絞り込み検索（カタカナ/ひらがな・全角/半角の違い、ラテン文字のアクセントの違いは無視）
const norm = s => s.normalize('NFKC').toLowerCase()
  .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
  .replace(/[\u00c0-\u024f]/g, ch => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

const input = document.getElementById('glossary-q');
const count = document.getElementById('glossary-count');
const items = [...document.querySelectorAll('.term')].map(el => ({ el, text: norm(el.textContent) }));

function filter() {
  const words = norm(input.value).split(/\s+/).filter(Boolean);
  let n = 0;
  for (const { el, text } of items) {
    const hit = words.every(w => text.includes(w));
    el.hidden = !hit;
    if (hit) n++;
  }
  // 該当する用語がない分野・区分は見出しごと隠す。検索中は分野へのジャンプ用リンクも隠す
  for (const sec of document.querySelectorAll('.glossary-cat, .glossary-group')) {
    sec.hidden = !sec.querySelector('.term:not([hidden])');
  }
  const nav = document.querySelector('.glossary-nav');
  if (nav) nav.hidden = words.length > 0;
  // 用語集の分野は開閉できる欄。検索中は当たりのある欄を開き、検索をやめたら利用者が開いた欄だけ残す
  for (const d of document.querySelectorAll('details.glossary-cat')) {
    if (words.length) {
      if (!('userOpen' in d.dataset)) d.dataset.userOpen = d.open ? '1' : '';
      d.open = !d.hidden;
    } else if ('userOpen' in d.dataset) {
      d.open = d.dataset.userOpen === '1';
      delete d.dataset.userOpen;
    }
  }
  count.textContent = count.dataset.label.replace('{n}', n);
}

// 用語ページのパンくず(#cat-分野)や用語へのリンク(#用語)で来たら、その欄を開いて見せる
function openTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  const el = id ? document.getElementById(id) : null;
  const d = el?.closest('details');
  if (!d) return;
  d.open = true;
  el.scrollIntoView();
}

input.addEventListener('input', filter);
window.addEventListener('hashchange', openTarget);
filter();
openTarget();
