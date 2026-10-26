// サイト全体の点検。ビルドした docs/ のページをすべて読み、次を調べる:
//   誤り(終了コード1): 内部リンク切れ、構造化データ(JSON-LD)が読めない、検索に出すページの title・description がない
//   注意(表示だけ): 検索に出すページどうしの title・description の重複、長すぎる title・description、容量(公開サイトの大きさとサイトマップのURL数)
// 実行: npm run build のあと node tools/check-site.js(注意の一覧も全部見るときは --all)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'docs');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const base = new URL(config.baseUrl).pathname; // 例: "/"
const showAll = process.argv.includes('--all');
const langs = new Set(config.languages.map(x => x.path.replace(/\/$/, '')).filter(Boolean));

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
})(out);

// リンク先が docs/ にあるか(/a/b/ → a/b/index.html、/a/b.png → a/b.png)
const exists = new Map();
const hasTarget = url => {
  let p = decodeURI(url.split(/[?#]/)[0]);
  if (!p.startsWith(base)) return true; // サイトの外
  p = p.slice(base.length);
  if (p === '' || p.endsWith('/')) p += 'index.html';
  if (!exists.has(p)) exists.set(p, fs.existsSync(path.join(out, p)));
  return exists.get(p);
};

// 長さの目安(検索結果で切れずに出る長さ)。日本語・中国語は全角1文字を2と数える
const width = s => [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e7f ? 2 : 1), 0);
const TITLE_MAX = 70; // 半角換算。サイト名(「 | 半導体教室」など)を除いた長さ
const DESC_MAX = 320; // 半角換算(全角でおよそ160字)

const errors = [];
const broken = new Map(); // リンク先 → 張っているページ
const titles = new Map();
const descs = new Map();
const longTitles = [];
const longDescs = [];
let indexed = 0;

for (const file of files) {
  const rel = path.relative(out, file);
  const html = fs.readFileSync(file, 'utf8');
  const noindex = /<meta name="robots" content="noindex">/.test(html);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|tel:|data:|#|javascript:)/.test(url)) {
      if (url.startsWith(config.baseUrl) && !hasTarget(url.slice(config.baseUrl.length - base.length))) {
        if (!broken.has(url)) broken.set(url, rel);
      }
      continue;
    }
    if (url.startsWith(base) && !hasTarget(url) && !broken.has(url)) broken.set(url, rel);
  }
  // テンプレートに渡し忘れた文言が、要素や属性の中身まるごと「undefined」「[object Object]」になっていないか(script の中は除く。「undefined behavior」のような本文は対象外)
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const leak = visible.match(/(?:>\s*|=")(undefined|\[object Object\])(?:\s*<|")/);
  if (leak) errors.push(`${rel}: 文言の渡し忘れ「${leak[1]}」があります`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { errors.push(`${rel}: JSON-LD が読めません(${e.message})`); }
  }
  if (noindex || rel === '404.html') continue;
  indexed++;
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = html.match(/<meta name="description" content="([^"]*)">/)?.[1];
  if (!title) errors.push(`${rel}: title がありません`);
  if (!desc) errors.push(`${rel}: description がありません`);
  if (title) {
    (titles.get(title) ?? titles.set(title, []).get(title)).push(rel);
    const body = title.replace(/ \| [^|]+$/, '');
    if (width(body) > TITLE_MAX) longTitles.push(`${rel}: ${body}`);
  }
  if (desc) {
    (descs.get(desc) ?? descs.set(desc, []).get(desc)).push(rel);
    if (width(desc) > DESC_MAX) longDescs.push(rel);
  }
}

for (const [url, from] of broken) errors.push(`リンク切れ: ${url}(${from} から)`);
const dup = m => [...m].filter(([, v]) => v.length > 1);
const dupTitles = dup(titles);
const dupDescs = dup(descs);

const list = (label, items, fmt = x => x) => {
  if (!items.length) return;
  console.log(`\n${label}: ${items.length}件`);
  for (const x of showAll ? items : items.slice(0, 10)) console.log(`  ${fmt(x)}`);
  if (!showAll && items.length > 10) console.log('  …(--all ですべて表示)');
};
console.log(`ページ ${files.length}(検索に出すページ ${indexed})を点検しました`);
list('誤り', errors);
list('注意: title の重複', dupTitles, ([t, v]) => `${t} ← ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` ほか${v.length - 3}` : ''}`);
list('注意: description の重複', dupDescs, ([t, v]) => `${t.slice(0, 50)}… ← ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` ほか${v.length - 3}` : ''}`);
// 長い title は種類(言語 + 最初のフォルダ)ごとの件数で出す。問題ページ(q)は問題文を入れているので長くなる
const kind = rel => rel.split('/').slice(0, langs.has(rel.split('/')[0]) ? 2 : 1).join('/');
const byKind = new Map();
for (const x of longTitles) byKind.set(kind(x), (byKind.get(kind(x)) ?? 0) + 1);
list(`注意: 長い title(サイト名を除いて半角${TITLE_MAX}超。種類ごとの件数)`, [...byKind].sort((a, b) => b[1] - a[1]), ([k, n]) => `${k}: ${n}`);
if (showAll) list('長い title の一覧', longTitles);
list(`注意: 長い description(半角${DESC_MAX}超)`, longDescs);
// 容量: GitHub Pages の公開サイトは 1 GB まで、サイトマップは1ファイル5万URLまで。8割を超えたら注意を出す
let bytes = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
walk(out);
// サイトマップ: /sitemap.xml は言語ごとのファイルの目次。目次に書いたファイルがあるか、1ファイルあたりのURL数(上限5万)を見る
const smIndex = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
const smFiles = [...smIndex.matchAll(/<sitemap><loc>([^<]+)<\/loc>/g)].map(m => m[1].slice(config.baseUrl.length));
const smCounts = smFiles.map(f => {
  const p = path.join(out, f);
  if (!fs.existsSync(p)) { errors.push(`サイトマップの目次にあるファイルがありません: ${f}`); return [f, 0]; }
  return [f, (fs.readFileSync(p, 'utf8').match(/<loc>/g) ?? []).length];
});
if (!smFiles.length) errors.push('sitemap.xml がサイトマップの目次(sitemapindex)になっていません');
const urls = smCounts.reduce((s, [, n]) => s + n, 0);
const [maxFile, maxUrls] = smCounts.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
const mb = bytes / 2 ** 20;
console.log(`\n容量: 公開するファイル ${mb.toFixed(0)} MB / 1024 MB(${(mb / 1024 * 100).toFixed(0)}%)、サイトマップ ${smFiles.length} ファイル・計 ${urls} URL(最も多い ${maxFile} が ${maxUrls} / 50000 URL = ${(maxUrls / 50000 * 100).toFixed(0)}%)`);
if (mb > 1024 * 0.8) console.log('注意: 公開するファイルが 1 GB の8割を超えました。大きなファイルや言語ごとのページ数を見直してください');
if (maxUrls > 50000 * 0.8) console.log(`注意: ${maxFile} が5万URLの8割を超えました(build.js の SITEMAP_MAX で分割されるはず)`);
if (errors.length) process.exit(1);
console.log('\nOK: 誤りはありません');
