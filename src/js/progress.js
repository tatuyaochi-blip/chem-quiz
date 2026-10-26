// トップ・分野ページの正答率と復習の表示
import * as store from './store.js';

// 正答率は学習した分野だけ表示する(分野カードでは、未学習なら欄ごと隠したまま)
for (const el of document.querySelectorAll('[data-rate]')) {
  const { rate } = store.stats(el.dataset.rate);
  if (rate == null) continue;
  el.textContent = `${rate}%`;
  el.closest('.cat-rate')?.removeAttribute('hidden');
}
for (const el of document.querySelectorAll('[data-answered]')) {
  el.textContent = store.stats(el.dataset.answered).answered;
}
// 分野ページの成績欄は、その分野を解いたことがあるときだけ出す
for (const el of document.querySelectorAll('[data-stat-tiles]')) {
  if (store.stats(el.dataset.statTiles).answered) el.hidden = false;
}
// 分野カードの進み具合(解いた問題数 / 問題数)
for (const bar of document.querySelectorAll('[data-progress]')) {
  const [cat, n] = bar.dataset.progress.split(':');
  const { answered } = store.stats(cat);
  if (!answered) continue;
  bar.style.width = `${Math.min(100, (answered / Number(n)) * 100)}%`;
  bar.parentElement.hidden = false;
}

// トップの「前回の続きから」: 解いた記録があれば、開始ボタンの下に
// 「前回の続き・今日の復習・間違えた問題」を出す。出せるものが1つもなければ出さない
const back = document.querySelector('[data-start="back"]');
if (back && store.hasRecords()) {
  const names = JSON.parse(back.querySelector('[data-cats]').dataset.cats);
  const fill = (el, n) => {
    const span = el.querySelector('span');
    span.textContent = span.textContent.replace('{n}', n);
    el.hidden = false;
  };
  const cont = back.querySelector('[data-continue]');
  const last = store.lastCategory();
  if (last && names[last]) {
    cont.href += `&c=${encodeURIComponent(last)}`;
    const span = cont.querySelector('span');
    span.textContent = span.textContent.replace('{name}', names[last]);
  } else cont.remove();
  if (store.dueCount()) fill(back.querySelector('[data-due]'), store.dueCount());
  if (store.weakCount()) fill(back.querySelector('[data-weak]'), store.weakCount());
  const cards = [...back.querySelectorAll('.start-card')].filter(a => !a.hidden);
  if (cards.length) back.hidden = false;
}

// トップページの連続学習日数と、今日の1問を解いたかどうか
const streakEl = document.querySelector('[data-streak]');
if (streakEl && store.streak()) {
  streakEl.textContent = streakEl.dataset.streak.replace('{n}', store.streak());
  streakEl.hidden = false;
}
const daily = document.querySelector('.mode-card[href*="mode=daily"]');
if (daily && streakEl && store.dailyDone()) {
  daily.classList.add('done');
  daily.querySelector('strong').append(` ✓ ${streakEl.dataset.dailyDone}`);
}
