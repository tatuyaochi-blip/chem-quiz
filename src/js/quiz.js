// クイズ画面。選択肢の数に依存しない（2択・3択・4択…すべて同じ処理）
import { h, home, getData, makeT } from './dom.js';
import * as store from './store.js';
import modes from './modes/index.js';
import { termMatcher, linkTerms, reportUrl, shuffle } from './util.js';
import { diagnosisReport } from './diagnosis.js';

const app = document.getElementById('quiz');
const params = Object.fromEntries(new URLSearchParams(location.search));
const mode = modes.find(m => m.id === params.mode) || modes.find(m => m.id === 'random');
const index = await getData('index.json');
const t = makeT(index.strings);
const catName = id => index.categories.find(c => c.id === id)?.name ?? '';
const label = index.modes[mode.id].label;
// ?c= が存在しない分野(古いリンクなど)のときは、分野の指定がないものとして扱う
const cat = index.categories.find(c => c.id === params.c);
// &t= で題名を指定できる(問題セットのURL)。長すぎるものは切る
const title = params.t ? params.t.slice(0, 80) : label + (cat ? ` : ${cat.name}` : '');
const homeUrl = cat ? `${home}c/${cat.id}/` : home;
const matcher = termMatcher(index.glossary);
const slugOf = new Map(index.glossary.map(g => [g.id, g.slug]));
// 別の意味で使う分野ではリンクしない用語(用語集の noLinkIn)
const skipIn = cat => new Set(index.glossary.filter(g => g.noLinkIn?.includes(cat) || (g.linkOnlyIn && !g.linkOnlyIn.includes(cat))).map(g => g.id));

// コード(問題文の下に表示する短いプログラム)。言語名は見出しとして小さく出す。
// コードがない問題では '' を返す(replaceChildren に undefined を渡すと「undefined」と表示されるため)
const codeBlock = q => (q.code ? h('pre', { class: 'q-code', 'data-lang': q.codeLang ?? '' }, h('code', {}, q.code)) : '');

// 図: ビルド時に作った SVG をそのまま入れる
const figure = svg => {
  const el = h('figure', { class: 'fig' });
  el.innerHTML = svg;
  return el;
};

// 解説の1文目(結論)を要点として太字にする。文の区切りが見つからない・長すぎるときは分けない
const FIRST = /^(.{12,320}?(?:[。！？]|(?<!\b\w)(?<!\bca)(?<!\bbzw)(?<!\be\.g)(?<!\bi\.e)(?<!\bvs)(?<!\bapprox)(?<!\bFig)[.!?](?=\s+\S)))\s*(\S[\s\S]*)$/;
const linked = (text, cat) => linkTerms(text, matcher, skipIn(cat)).map(p => (typeof p === 'string' ? p
  : h('a', { class: 'term-link', href: `${home}term/${slugOf.get(p.id)}/` }, p.text)));
const explanationText = (text, cat) => {
  const m = text.match(FIRST);
  return m ? [h('strong', { class: 'key-point' }, linked(m[1], cat)), ' ', linked(m[2], cat)] : linked(text, cat);
};

// 解説文(用語集の語にリンク)、図、選択肢ごとの補足(choiceNotes)、誤り報告リンク
const explain = q => h('div', {},
  h('p', { class: 'explanation' }, explanationText(q.explanation, q.cat)),
  q.figureSvg && !q.figureFirst && figure(q.figureSvg),
  q.choiceNotes && h('ul', { class: 'choice-notes' }, q.choiceNotes.map((note, n) =>
    note && h('li', {}, h('b', {}, `${String.fromCharCode(65 + n)}. `), note))),
  index.reportFormUrl && h('p', { class: 'q-report' },
    // 外部のフォームは別のタブで、サイト内のお問い合わせページ(フォームの URL がないとき)は同じタブで開く
    h('a', { class: 'report-link', href: reportUrl(index.reportFormUrl, q.id, index.lang, q.cat), ...(/^https?:/.test(index.reportFormUrl) ? { target: '_blank', rel: 'noopener' } : { rel: 'nofollow' }) }, t('report_error'))));

// 言語を切り替えても同じ出題条件(?mode=…&c=…)のままにする
document.querySelectorAll('.lang-switch a').forEach(a => (a.search = location.search));

// 選択肢の順番を出題のたびに入れ替える(正解の位置を覚えたり読んだりできないように)。
// 正解の番号と選択肢ごとの補足も同じ順に並べ替える
function shuffleChoices(q) {
  const order = shuffle(q.choices.map((_, n) => n));
  return {
    ...q,
    choices: order.map(n => q.choices[n]),
    choiceNotes: q.choiceNotes && order.map(n => q.choiceNotes[n]),
    answer: order.indexOf(q.answer),
  };
}

// アクセス解析(GA4)へのイベント送信。タグがない(オフライン・未設定)ときは何もしない
const track = (name, p) => { try { window.gtag?.('event', name, { mode: mode.id, category: cat?.id ?? '', ...p }); } catch {} };

let qs, i, answers, done, finished, loadError;
start();

// retry を渡すと、その問題だけを出し直す(結果画面の「間違えた問題を解き直す」)
async function start(retry) {
  if (retry) qs = shuffle(retry).map(shuffleChoices);
  else {
    const known = new Set(index.categories.map(c => c.id));
    const ids = mode.load ? [] : (mode.cats ? mode.cats(params, index) : [...known]).filter(id => known.has(id));
    try {
      // 問題を自分で作るモード(load。用語の対訳クイズなど)と、分野の問題から選ぶモード(pick)
      if (mode.load) qs = (await mode.load({ params, index, getData })).map(shuffleChoices);
      else {
        const pool = (await Promise.all(ids.map(id =>
          getData(`q/${id}.json`).then(list => list.map(q => ({ ...q, cat: id })))))).flat();
        qs = mode.pick(pool, params, { store, index }).map(shuffleChoices);
      }
    } catch {
      qs = []; // 問題データを読めない(オフラインで未保存など)
      loadError = true;
    }
  }
  i = 0;
  answers = [];
  finished = false;
  document.title = `${title} | ${document.title.split(' | ').pop()}`;
  if (!qs.length) {
    app.replaceChildren(
      h('h1', {}, title),
      h('p', {}, (!loadError && index.modes[mode.id].empty) || t('no_questions')),
      h('a', { class: 'btn btn-primary', href: homeUrl }, t('back')));
    return;
  }
  if (!retry) track('quiz_start', { total: qs.length });
  show();
}

function show() {
  const q = qs[i];
  done = false;
  const buttons = q.choices.map((text, n) =>
    h('button', { class: 'choice', type: 'button', onclick: () => answer(n) },
      h('span', { class: 'choice-mark' }, String.fromCharCode(65 + n)),
      h('span', { class: 'choice-text' }, text)));

  app.replaceChildren(
    h('div', { class: 'quiz-head' },
      h('span', { class: 'quiz-title' }, title),
      h('span', { class: 'quiz-count' }, `${i + 1} / ${qs.length}`),
      h('button', { class: 'quiz-quit', type: 'button', onclick: quit }, t('quit'))),
    h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: `width:${(i / qs.length) * 100}%` })),
    h('p', { class: 'q-cat' }, catName(q.cat)),
    q.codeFirst ? codeBlock(q) : '',
    h('h1', { class: 'q-text' }, q.question),
    q.codeFirst ? '' : codeBlock(q),
    q.figureFirst && q.figureSvg ? figure(q.figureSvg) : '',
    h('div', { class: 'choices' }, buttons),
    h('div', { class: 'feedback', hidden: true }));
  window.scrollTo(0, 0);
}

function answer(n) {
  if (done) return;
  done = true;
  const q = qs[i];
  const ok = n === q.answer;
  if (mode.record !== false) store.record(q.id, q.cat, ok); // 分野の問題でないモードは、分野ごとの記録に入れない
  answers.push({ q, choice: n, ok });
  track('answer', { source: 'quiz', first: answers.length === 1, ok });

  const buttons = app.querySelectorAll('.choice');
  buttons.forEach(b => (b.disabled = true));
  app.querySelector('.progress-bar').style.width = `${((i + 1) / qs.length) * 100}%`;

  if (mode.feedback === 'end') {
    buttons[n].classList.add('selected');
    setTimeout(next, 300);
    return;
  }

  buttons[q.answer].classList.add('correct');
  if (!ok) buttons[n].classList.add('wrong');
  const fb = app.querySelector('.feedback');
  const last = i === qs.length - 1;
  // 判定の横に「次へ」を置き、解説が長くても読まずに進めるようにする(解説の後ろにも同じボタン)
  const nextLabel = last ? t('see_result') : t('next');
  fb.replaceChildren(
    h('div', { class: 'fb-head' },
      h('p', { class: `verdict ${ok ? 'ok' : 'ng'}` }, ok ? t('correct') : t('incorrect', { mark: String.fromCharCode(65 + q.answer) })),
      h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: next }, nextLabel)),
    explain(q),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: next }, nextLabel));
  fb.className = `feedback ${ok ? 'ok' : 'ng'}`;
  fb.hidden = false;
  fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function next() {
  if (finished) return; // 「ここで終了」のあとに、模擬試験の自動送り(setTimeout)が来ても何もしない
  i++;
  if (i < qs.length) show();
  else result();
}

// 「ここで終了」: 解いた分だけで結果を出す(記録は1問ごとに保存済み)。1問も解いていなければ元のページへ
function quit() {
  if (!answers.length) location.href = homeUrl;
  else result();
}

function result() {
  finished = true;
  const score = answers.filter(a => a.ok).length;
  const total = answers.length;
  const pct = Math.round((score / total) * 100);
  store.addHistory({ mode: mode.id, c: cat?.id ?? null, score, total });
  track('quiz_complete', { score, total });
  const msg = t(pct >= 80 ? 'msg_good' : pct >= 60 ? 'msg_mid' : 'msg_low');
  const wrong = total - score;

  app.replaceChildren(
    h('div', { class: 'result' },
      h('p', { class: 'quiz-title' }, title),
      h('h1', {}, t('result')),
      h('p', { class: 'score' }, h('b', {}, score), t('score_total', { total })),
      h('p', { class: 'score-pct' }, t('rate_pct', { pct })),
      h('p', {}, msg),
      h('div', { class: 'actions' },
        // 今回間違えた問題だけを、この画面のまま出し直す(過去の苦手問題は混ぜない)
        wrong > 0 && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => start(answers.filter(a => !a.ok).map(a => a.q)) }, t('retry_wrong')),
        h('button', { class: `btn ${wrong ? 'btn-ghost' : 'btn-primary'}`, type: 'button', onclick: () => start() }, t('again')),
        h('a', { class: 'btn btn-ghost', href: homeUrl }, t(cat ? 'to_category' : 'to_top')),
        shareButton(score, total))),
    mode.report === 'diagnosis' ? diagnosisReport(answers, index, t) : '', // replaceChildren は false を文字として出すので '' にする
    h('h2', {}, t('review_heading')),
    h('ol', { class: 'review' }, answers.map(({ q, choice, ok }) =>
      h('li', { class: ok ? 'ok' : 'ng' },
        h('details', { open: !ok },
          h('summary', {}, h('span', { class: 'badge' }, ok ? '○' : '×'), q.question),
          codeBlock(q),
          h('ul', { class: 'review-choices' }, q.choices.map((c, n) =>
            h('li', { class: n === q.answer ? 'is-answer' : n === choice ? 'is-chosen' : '' },
              `${String.fromCharCode(65 + n)}. ${c}`,
              n === q.answer ? t('mark_correct') : n === choice ? t('mark_yours') : ''))),
          explain(q))))));
  window.scrollTo(0, 0);
}

// 結果の共有: Web Share API、使えなければ X の共有リンク
function shareButton(score, total) {
  const text = t('share_text', { title: cat ? cat.name : label, score, total, site: index.siteName });
  const url = new URL(homeUrl, location.href).href;
  if (navigator.share) {
    return h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => navigator.share({ text, url }).catch(() => {}) }, t('share'));
  }
  return h('a', { class: 'btn btn-ghost', href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, target: '_blank', rel: 'noopener' }, t('share'));
}

// キーボード操作: 数字キーで選択、Enterで次へ
document.addEventListener('keydown', e => {
  // Ctrl+1 などブラウザのショートカット、キーの押しっぱなしでは反応しない
  if (!qs?.length || finished || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const n = Number(e.key) - 1;
  if (!done && n >= 0 && n < qs[i].choices.length) answer(n);
  else if (done && e.key === 'Enter' && mode.feedback !== 'end') {
    e.preventDefault();
    next();
  }
});
