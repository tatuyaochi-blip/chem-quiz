// 個別問題・用語・比較ページの問題を、その場で解けるようにする。
// 静的HTMLの選択肢(.q-choices li)をボタンに置き換え、選ぶと正誤を表示して解説を開き、学習記録に残す。
// JS が動かないときは、従来どおり「答えと解説を見る」で読める
import * as store from './store.js';

const track = (name, p) => { try { window.gtag?.('event', name, p); } catch {} };

for (const box of document.querySelectorAll('[data-qid]')) {
  const items = [...box.querySelectorAll('.q-choices > li')];
  const answer = Number(box.dataset.answer);
  const buttons = items.map((li, n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.append(...li.childNodes);
    btn.addEventListener('click', () => choose(n));
    li.replaceChildren(btn);
    return btn;
  });
  box.classList.add('q-live');

  function choose(n) {
    const ok = n === answer;
    buttons.forEach(b => (b.disabled = true));
    buttons[answer].classList.add('correct');
    if (!ok) buttons[n].classList.add('wrong');
    // 自分の答えの正誤を、解説の上に出す
    const details = box.querySelector('.q-answer');
    const verdict = document.createElement('p');
    verdict.className = `verdict ${ok ? 'ok' : 'ng'}`;
    verdict.textContent = ok ? box.dataset.correct : box.dataset.incorrect;
    details.before(verdict);
    details.open = true;
    box.querySelector('.q-continue')?.removeAttribute('hidden');
    store.record(box.dataset.qid, box.dataset.cat, ok);
    track('answer', { source: box.classList.contains('q-page') ? 'qpage' : 'qmini', category: box.dataset.cat, ok });
  }
}
