// 弱点診断の結果(クイズの結果画面に差し込む)。answers: [{ q, ok }]
import { h, home } from './dom.js';
import * as store from './store.js';

export function diagnosisReport(answers, index, t) {
  const okByCat = new Map(answers.map(a => [a.q.cat, a.ok]));
  const groups = index.exams.flatMap(e => e.groups.map(g => {
    const cats = index.categories.filter(c => c.exam === e.id && c.group === g.id && okByCat.has(c.id));
    const ok = cats.filter(c => okByCat.get(c.id)).length;
    return { id: g.id, name: g.name, cats, ok, total: cats.length, rate: cats.length ? Math.round((ok / cats.length) * 100) : null };
  })).filter(g => g.total);

  // おすすめ: 今回間違えた分野を、正答率の低い区分 → 通算の正答率の低い分野の順に3つ
  const groupRate = new Map(groups.flatMap(g => g.cats.map(c => [c.id, g.rate])));
  const pastRate = id => store.stats(id).rate ?? 0;
  const picks = index.categories.filter(c => okByCat.get(c.id) === false)
    .sort((a, b) => groupRate.get(a.id) - groupRate.get(b.id) || pastRate(a.id) - pastRate(b.id))
    .slice(0, 3);

  return h('section', { class: 'diagnosis' },
    h('h2', {}, t('diag_groups')),
    h('div', { class: 'stat-rows' }, groups.map(g =>
      h('div', { class: 'stat-row' },
        h('span', { class: 'stat-name' }, g.name),
        h('div', { class: 'meter', role: 'img', 'aria-label': `${g.name} ${g.rate}%` }, h('div', { class: 'meter-bar', style: `width:${g.rate}%` })),
        h('span', { class: 'stat-pct' }, `${g.rate}%`),
        h('span', { class: 'stat-sub' }, t('diag_score', { ok: g.ok, total: g.total }))))),

    h('h2', {}, t('diag_recommend')),
    picks.length
      ? [h('p', { class: 'muted' }, t('diag_recommend_note')),
        h('ul', { class: 'cat-grid' }, picks.map(c => h('li', {},
          h('a', { class: 'cat-card', href: `${home}c/${c.id}/` },
            h('span', { class: 'cat-name' }, c.name),
            h('span', { class: 'cat-meta' }, h('span', {}, groups.find(g => g.cats.includes(c)).name),
              h('span', {}, t('diag_past'), ' ', h('b', {}, `${pastRate(c.id)}%`)))))))]
      : h('p', {}, t('diag_all_correct')),

    // 分野ごとの○×(図の内容を表でも読めるように)
    h('details', { class: 'diag-cats' },
      h('summary', {}, t('diag_by_cat')),
      groups.map(g => [
        h('h3', {}, g.name),
        h('ul', {}, g.cats.map(c => h('li', { class: okByCat.get(c.id) ? 'ok' : 'ng' },
          h('span', { class: 'badge' }, okByCat.get(c.id) ? '○' : '×'),
          h('a', { href: `${home}c/${c.id}/` }, c.name))))])));
}
