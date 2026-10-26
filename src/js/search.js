// サイト内検索(検索ページ)。索引 data/{言語}/search.json を読み込み、比較・用語・分野・図解・問題をキーワードで絞り込む。
// カタカナ/ひらがな・全角/半角の違いは無視する(用語集の検索と同じ)
const norm = s => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const root = document.documentElement;
const input = document.getElementById('site-q');
const out = document.getElementById('search-results');
const countEl = document.getElementById('search-count');
const ORDER = ['l', 'c', 't', 'k', 'f', 'q'];
const LIMIT = { l: 5, c: 8, t: 12, k: 6, f: 6, q: 20 };
const expanded = new Set();

let S, index;
try {
  const res = await fetch(`${root.dataset.base}data/${root.dataset.lang}/search.json`);
  const data = await res.json();
  S = data.strings;
  index = data.items.map(it => ({ ...it, nt: norm(it.n), nx: norm(`${it.x || ''} ${it.k || ''}`) }));
} catch {
  countEl.textContent = 'Search is not available right now.';
}

function search(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hits = [];
  if (!words.length) return hits;
  for (const it of index) {
    let score = 0;
    for (const w of words) {
      if (it.nt.includes(w)) score += it.nt.startsWith(w) ? 5 : 3;
      else if (it.nx.includes(w)) score += 1;
      else { score = -1; break; }
    }
    if (score > 0) hits.push({ it, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

function render() {
  const q = input.value.trim();
  out.replaceChildren();
  if (!q) { countEl.textContent = S.search_hint; return; }
  const hits = search(q);
  countEl.textContent = hits.length ? S.search_count.replace('{n}', hits.length) : S.search_none;
  for (const type of ORDER) {
    const list = hits.filter(h => h.it.t === type);
    if (!list.length) continue;
    const sec = document.createElement('section');
    sec.className = 'search-group';
    const h2 = document.createElement('h2');
    h2.textContent = `${S['search_g_' + type]} (${list.length})`;
    const ul = document.createElement('ul');
    ul.className = 'search-list';
    for (const { it } of expanded.has(type) ? list : list.slice(0, LIMIT[type])) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = root.dataset.home + it.u;
      a.textContent = it.n;
      const small = document.createElement('small');
      small.textContent = (it.x || '').slice(0, 90);
      a.append(small);
      li.append(a);
      ul.append(li);
    }
    sec.append(h2, ul);
    if (!expanded.has(type) && list.length > LIMIT[type]) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-ghost';
      more.textContent = S.search_more;
      more.addEventListener('click', () => { expanded.add(type); render(); });
      sec.append(more);
    }
    out.append(sec);
  }
}

if (index) {
  input.value = new URLSearchParams(location.search).get('q') || '';
  input.addEventListener('input', () => {
    render();
    const q = input.value.trim();
    history.replaceState(null, '', q ? `?q=${encodeURIComponent(q)}` : location.pathname);
  });
  render();
  if (!input.value) input.focus();
}
