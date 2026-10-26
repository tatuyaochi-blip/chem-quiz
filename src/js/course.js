// 学習コースの進み具合(トップのコース一覧と、コースのページ)
import * as store from './store.js';

// 分野の「完了」: 問題の6割以上を解き、正答率が80%以上
export const isDone = (cat, count) => {
  const s = store.stats(cat);
  return s.answered >= count * 0.6 && (s.rate ?? 0) >= 80;
};

// トップのコース一覧: 完了した分野の数とバー
for (const card of document.querySelectorAll('[data-course-card]')) {
  const steps = card.dataset.courseCard.split(' ').map(x => x.split(':'));
  const done = steps.filter(([cat, n]) => isDone(cat, Number(n))).length;
  card.querySelector('[data-course-done]').textContent = `${done} / ${steps.length}`;
  card.querySelector('.meter-bar').style.width = `${(done / steps.length) * 100}%`;
}

// コースのページ: 各分野の状態、全体の進み具合、次に学ぶ分野
const list = document.querySelector('.course-steps');
if (list) {
  const steps = [...list.querySelectorAll('.course-step')];
  let next = null;
  for (const li of steps) {
    const { cat, count } = li.dataset;
    const s = store.stats(cat);
    li.querySelector('[data-rate]').textContent = s.rate == null ? '—' : `${s.rate}%`;
    li.querySelector('[data-answered]').textContent = `${s.answered}/${count}`;
    if (isDone(cat, Number(count))) {
      li.classList.add('done');
      li.querySelector('.step-status').textContent = list.dataset.doneLabel;
    } else if (!next) {
      next = li;
      li.classList.add('next');
    }
  }
  const done = steps.filter(li => li.classList.contains('done')).length;
  const prog = document.querySelector('[data-course-progress]');
  prog.querySelector('.course-progress-text').textContent = prog.dataset.courseProgress
    .replace('{done}', done).replace('{total}', steps.length);
  prog.querySelector('.meter-bar').style.width = `${(done / steps.length) * 100}%`;

  const box = document.querySelector('.course-next');
  if (next) {
    box.querySelector('.course-next-name').textContent = next.querySelector('.step-name').textContent;
    box.querySelector('a').href = box.dataset.solve + next.dataset.cat;
  } else {
    box.querySelector('.course-next-label').textContent = box.dataset.allDone;
    box.querySelector('p:last-child').remove();
  }
  box.hidden = false;
}
