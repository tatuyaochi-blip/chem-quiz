// 計算ツールの共通の機能: 入力をURLのクエリに残す(共有・ブックマーク用)、結果のコピー、お気に入りと最近使ったツール。
// 各ツールの {id}.js より先に読み込み、URLの値を入力欄に入れてから計算させる
import { isToolFav, toggleToolFav, useTool } from './store.js';

const bar = document.querySelector('[data-tool-id]');
const id = bar?.dataset.toolId;
const form = document.querySelector('.dy form');
// URLに残すのは数値の入力欄と選択肢(テキストやチェックボックスは使わない)
const fields = bar?.dataset.share != null && form ? [...form.elements].filter(el => el.name && (el.tagName === 'SELECT' || el.type === 'number')) : [];
const initial = el => (el.tagName === 'SELECT' ? ([...el.options].find(o => o.defaultSelected) ?? el.options[0])?.value : el.defaultValue);

// URLの値を入力欄へ(選べない値や数値でない値は無視する)
const params = new URLSearchParams(location.search);
for (const el of fields) {
  if (!params.has(el.name)) continue;
  const v = params.get(el.name).trim();
  if (el.tagName === 'SELECT' ? [...el.options].some(o => o.value === v) : v !== '' && Number.isFinite(Number(v))) el.value = v;
}

// 入力が変わるたびにURLを書き換える。既定値のままならクエリなし、1つでも変えたら全部の値を入れる(既定値が変わっても同じ結果になるように)
function sync() {
  const changed = fields.some(el => el.value !== initial(el));
  const query = changed ? `?${fields.map(el => `${el.name}=${encodeURIComponent(el.value)}`).join('&')}` : '';
  history.replaceState(history.state, '', location.pathname + query + location.hash);
  // 言語の切り替え先にも同じ条件を渡す
  document.querySelectorAll('.lang-switch a').forEach(a => { a.search = query; });
}
if (fields.length) {
  // 各ツールが入力に合わせてほかの欄を書き換えることがあるので、それが済んでから書き換える
  form.addEventListener('input', () => setTimeout(sync));
  form.addEventListener('change', () => setTimeout(sync));
  sync();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
function flash(btn) {
  const old = btn.textContent;
  btn.textContent = btn.dataset.done;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

// 結果のテキスト: ツール名、入力(ラベル: 値)、結果(見出し: 値。表は計算結果の入る表だけをタブ区切りで)、URL
const clean = el => el?.textContent.trim().replace(/\s+/g, ' ') ?? '';
function resultText() {
  const lines = [clean(document.querySelector('h1')), ''];
  const inHead = form?.querySelector('h2');
  if (inHead) lines.push(`[${clean(inHead)}]`);
  for (const el of fields) lines.push(`${clean(el.closest('label')?.querySelector('span'))}: ${el.tagName === 'SELECT' ? clean(el.selectedOptions[0]) : el.value}`);
  for (const sec of document.querySelectorAll('.dy .dy-out:not(#sweep)')) {
    if (sec.hidden || !sec.querySelector('[data-out]')) continue;
    lines.push('', `[${clean(sec.querySelector('h2'))}]`);
    for (const d of sec.querySelectorAll('.dy-stats > div')) lines.push(`${clean(d.querySelector('dt'))}: ${clean(d.querySelector('dd'))}`);
    for (const table of sec.querySelectorAll('table')) {
      if (!table.querySelector('[data-out]')) continue;
      for (const row of table.rows) lines.push([...row.cells].map(clean).join('\t'));
    }
  }
  lines.push('', location.href);
  return lines.join('\n');
}

if (bar) {
  bar.hidden = false;
  const fav = bar.querySelector('[data-fav]');
  const showFav = () => {
    const on = isToolFav(id);
    fav.textContent = on ? fav.dataset.on : fav.dataset.off;
    fav.setAttribute('aria-pressed', String(on));
  };
  fav.addEventListener('click', () => { toggleToolFav(id); showFav(); });
  showFav();
  bar.querySelector('[data-copy-result]')?.addEventListener('click', async e => {
    const btn = e.currentTarget; // await のあとは currentTarget が null になる
    if (await copy(resultText())) flash(btn);
  });
  bar.querySelector('[data-share]')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url: location.href }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    if (await copy(location.href)) flash(btn);
  });
  useTool(id);
}
