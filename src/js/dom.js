// ブラウザ用の共通関数

const root = document.documentElement;
export const base = root.dataset.base;   // サイトのルート(データ・CSS・JSの置き場所)
export const home = root.dataset.home;   // 表示中の言語のトップ(ページへのリンクに使う)
export const lang = root.dataset.lang;

// 表示中の言語のデータを読む: getData('index.json') → data/{lang}/index.json
export const getData = path => fetch(`${base}data/${lang}/${path}`).then(r => r.json());

// 文言の取り出し: t('incorrect', { mark: 'A' })
export const makeT = strings => (key, vars = {}) =>
  (strings[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// h('button', { class: 'x', onclick: fn }, '子要素', ...)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}
