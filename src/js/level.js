// 分野ページの難易度の絞り込み: 問題一覧と「10問練習」「この分野を解く」のリンクに反映する
const buttons = document.querySelectorAll('[data-level-btn]');
const solves = document.querySelectorAll('.mode-card[href*="mode=category"]');

for (const b of buttons) {
  b.addEventListener('click', () => {
    const lv = b.dataset.levelBtn;
    buttons.forEach(x => x.setAttribute('aria-pressed', x === b));
    document.querySelectorAll('.q-list li').forEach(li => (li.hidden = lv && li.dataset.level !== lv));
    for (const solve of solves) {
      const url = new URL(solve.href);
      if (lv) url.searchParams.set('level', lv);
      else url.searchParams.delete('level');
      solve.href = url.href;
    }
  });
}
