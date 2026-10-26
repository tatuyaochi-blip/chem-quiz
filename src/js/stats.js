// 成績ページ
import { h, home, getData, makeT } from './dom.js';
import * as store from './store.js';

const root = document.getElementById('stats');
const index = await getData('index.json');
const t = makeT(index.strings);
const catName = id => index.categories.find(c => c.id === id)?.name;
const pct = rate => (rate == null ? '—' : `${rate}%`);

render();

function render() {
  const all = store.stats();
  const total = index.categories.reduce((s, c) => s + c.count, 0);
  const history = store.history().slice(0, 10);

  root.replaceChildren(h('div', {},
    h('div', { class: 'stat-tiles' },
      tile(pct(all.rate), t('overall_rate')),
      tile(`${all.answered}`, t('answered_of', { total })),
      tile(`${all.weak}`, t('weak_count')),
      tile(`${store.history().length}`, t('attempts')),
      tile(`${store.streak()}`, t('streak_days'))),
    all.weak > 0 && h('p', {}, h('a', { class: 'btn btn-primary', href: `${home}quiz/?mode=weak` }, t('solve_weak', { n: all.weak }))),

    // 問題のある分野がひとつもない区分(準備中)は出さない
    index.exams.map(e => e.groups.filter(g => index.categories.some(c => c.exam === e.id && c.group === g.id)).map(g =>
      h('section', {},
        h('h2', {}, g.name),
        h('div', { class: 'stat-rows' }, index.categories.filter(c => c.exam === e.id && c.group === g.id).map(c => {
          const s = store.stats(c.id);
          return h('div', { class: 'stat-row' },
            h('a', { class: 'stat-name', href: `${home}c/${c.id}/` }, c.name),
            h('div', { class: 'meter' }, h('div', { class: 'meter-bar', style: `width:${s.rate ?? 0}%` })),
            h('span', { class: 'stat-pct' }, pct(s.rate)),
            h('span', { class: 'stat-sub' }, t('answered_n', { a: s.answered, c: c.count }),
              s.weak > 0 && h('a', { href: `${home}quiz/?mode=weak&c=${c.id}` }, t('weak_n', { n: s.weak }))));
        }))))),

    h('section', {},
      h('h2', {}, t('recent')),
      history.length
        ? h('ul', { class: 'history' }, history.map(x => h('li', {},
          h('span', { class: 'muted' }, new Date(x.at).toLocaleString(index.locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
          h('span', {}, (index.modes[x.mode]?.label ?? x.mode) + (x.c ? ` : ${catName(x.c)}` : '')),
          h('b', {}, `${x.score}/${x.total}`))))
        : h('p', { class: 'muted' }, t('no_history'))),

    h('section', {},
      h('h2', {}, t('backup_heading')),
      h('p', { class: 'muted' }, t('backup_note')),
      h('div', { class: 'backup' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: exportFile }, t('export_button')),
        h('label', { class: 'btn btn-ghost' }, t('import_button'),
          h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => importFile(e.target.files[0]) })))),

    h('section', {},
      h('h2', {}, t('reset_heading')),
      h('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => {
          if (confirm(t('reset_confirm'))) {
            store.reset();
            render();
          }
        },
      }, t('reset_button')))));
}

// 記録をJSONファイルとして保存する(ファイル名に今日の日付)
function exportFile() {
  const url = URL.createObjectURL(new Blob([store.exportData()], { type: 'application/json' }));
  h('a', { href: url, download: `quiz-records-${new Date().toLocaleDateString('sv-SE')}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}

// 保存したJSONファイルで記録を置き換える
async function importFile(file) {
  if (!file || !confirm(t('import_confirm'))) return;
  alert(store.importData(await file.text()) ? t('import_done') : t('import_error'));
  render();
}

function tile(num, label) {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-num' }, num), h('span', { class: 'tile-label' }, label));
}
