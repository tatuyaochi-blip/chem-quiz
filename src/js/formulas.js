// 公式集(/formulas/)。式のカードは build.js が data/formulas.json から作ってページに書く(JavaScript がなくても全部読める)。
// このファイルは、検索(名前・記号・用語)と分野で絞ること、式を選ぶこと(このブラウザの localStorage と URL の ?f=id,id)、
// 選んだ式だけの印刷(html に fm-print-sel を付けてから印刷。2段組みの印刷の CSS は style.css)、選んだ式の URL のコピー。
// URL の ?q=語 と ?g=分野 も読む。保存できないブラウザでも、選んだ式は URL で残る
const app = document.getElementById('fm-app');
const list = document.getElementById('fm-list');
if (app && list) init();

// 検索の文字をそろえる(全角・半角、下付き・上付きの数字、大文字・小文字、空白と記号の違いを消す)。
// ラテン文字のアクセントも外す(índice を indice で、Pérot を perot で引ける。glossary.js・search.js と同じやり方)。
// 小数点のコンマとピリオドも消す(1.22 と 1,22 が同じになる)
export function norm(s) {
  return String(s).normalize('NFKC').toLowerCase()
    .replace(/[\u00c0-\u024f]/g, ch => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .replace(/[\s_{}^·・,.、。()()[\]「」:：/'’"\-‐–]/g, '');
}

function init() {
  const T = JSON.parse(app.dataset.t || '{}');
  const t = (k, v = {}) => (T[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (x in v ? v[x] : m));
  // 同じオリジン(github.io)のほかのサイトと混ざらないよう、キーにサイトの名前を付ける
  const KEY = 'chem:formulasPicked';
  const html = document.documentElement;
  const cards = [...list.querySelectorAll('.fm-card')];
  const groups = [...list.querySelectorAll('.fm-group')];
  const ids = new Set(cards.map(c => c.dataset.id));
  const keyOf = new Map(cards.map(c => [c, norm(c.dataset.k || '')]));
  const box = id => list.querySelector(`[data-pick="${id}"]`);
  const q = document.getElementById('fm-q');
  const only = document.getElementById('fm-only');
  const more = document.getElementById('fm-more');
  const chips = [...app.querySelectorAll('.fm-chips [data-g]')];
  const count = app.querySelector('.fm-count');
  const selN = app.querySelector('.fm-sel-n');
  const msg = app.querySelector('.fm-msg');
  const none = document.querySelector('.fm-none');
  let group = '';

  // 選んだ式: URL の ?f= があればそれを、なければこのブラウザに残したもの
  const params = new URLSearchParams(location.search);
  const fromUrl = params.has('f');
  let picked = new Set();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...picked])); } catch {} };
  for (const id of fromUrl ? (params.get('f') || '').split(',') : load()) if (ids.has(id)) picked.add(id);
  if (fromUrl) save();
  if (params.get('q')) q.value = params.get('q');
  if (params.get('g') && chips.some(c => c.dataset.g === params.get('g'))) group = params.get('g');
  only.checked = fromUrl && picked.size > 0;

  list.classList.add('fm-js');
  app.hidden = false;

  // URL の ?f= を選んだ式に合わせる(ページ内のリンク #f-… はそのまま)
  const syncUrl = () => {
    const u = new URL(location.href);
    if (picked.size) u.searchParams.set('f', order().join(',')); else u.searchParams.delete('f');
    try { history.replaceState(history.state, '', u.pathname + u.search.replace(/%2C/gi, ',') + u.hash); } catch {}
  };
  const order = () => cards.map(c => c.dataset.id).filter(id => picked.has(id)); // ページの順に並べる

  function render() {
    const words = norm(q.value) ? q.value.split(/[\s　]+/).map(norm).filter(Boolean) : [];
    let n = 0;
    for (const c of cards) {
      const on = picked.has(c.dataset.id);
      c.classList.toggle('is-picked', on);
      const b = box(c.dataset.id);
      if (b) b.checked = on;
      const show = (!group || c.dataset.g === group) && words.every(w => keyOf.get(c).includes(w)) && (!only.checked || on);
      c.hidden = !show;
      if (show) n++;
    }
    for (const g of groups) {
      g.hidden = !g.querySelector('.fm-card:not([hidden])');
      g.classList.toggle('has-picked', !!g.querySelector('.fm-card.is-picked'));
    }
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.g === group));
    count.textContent = t('formulas_count', { n, total: cards.length });
    none.hidden = n > 0;
    selN.textContent = t('formulas_picked', { n: picked.size });
    html.classList.toggle('fm-print-more', more.checked);
  }

  const flash = text => { msg.textContent = text; msg.hidden = false; clearTimeout(flash.tm); flash.tm = setTimeout(() => { msg.hidden = true; }, 4000); };

  q.addEventListener('input', render);
  for (const c of chips) c.addEventListener('click', () => { group = c.dataset.g; render(); });
  only.addEventListener('change', render);
  more.addEventListener('change', render);
  list.addEventListener('change', e => {
    const id = e.target.dataset?.pick;
    if (!id) return;
    if (e.target.checked) picked.add(id); else picked.delete(id);
    save(); syncUrl(); render();
  });
  app.querySelector('[data-clear]').addEventListener('click', () => { picked = new Set(); only.checked = false; save(); syncUrl(); render(); });
  app.querySelector('[data-print]').addEventListener('click', () => {
    if (!picked.size) { flash(t('formulas_pick_first')); return; }
    html.classList.add('fm-print-sel');
    window.print();
  });
  // 記号の表と説明は画面では最初は閉じている(details)。印刷のときだけ全部開き、終わったら元に戻す
  const xs = [...list.querySelectorAll('details.fm-x')];
  window.addEventListener('beforeprint', () => { for (const d of xs) { d.dataset.was = d.open ? '1' : ''; d.open = true; } });
  window.addEventListener('afterprint', () => { html.classList.remove('fm-print-sel'); for (const d of xs) d.open = d.dataset.was === '1'; });
  app.querySelector('[data-share]').addEventListener('click', async () => {
    if (!picked.size) { flash(t('formulas_pick_first')); return; }
    const u = new URL(location.pathname, location.origin);
    u.searchParams.set('f', order().join(','));
    const text = u.href.replace(/%2C/gi, ',');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { try { window.prompt('', text); } catch {} }
    else flash(t('compare_link_copied'));
  });

  // ページ内のリンク(#f-…)の式が絞り込みで隠れているときは、絞り込みを外して見せる
  const reveal = () => {
    const m = location.hash.match(/^#(f-[a-z0-9-]+|g-[a-z]+)$/);
    const el = m && document.getElementById(m[1]);
    if (!el || !list.contains(el) || (!el.hidden && !el.closest('[hidden]'))) return;
    q.value = ''; group = ''; only.checked = false; render();
    el.scrollIntoView();
  };
  window.addEventListener('hashchange', reveal);
  render();
  reveal();
}
