// src/ と data/ から docs/ を生成する。実行: node tools/build.js
// 言語ごとに出力する(config.languages の先頭が既定言語でルート、ほかは /en/ など)。
// 翻訳がない問題はその言語では出さない。分野名・用語・UI文言は、翻訳がなければ既定言語で表示する。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validate } from './validate.js';
import { termMatcher, linkTerms, reportUrl } from '../src/js/util.js';
import { iconPng } from './icon.js';
import { figures, localizeFigure } from './figures.js';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'docs');
const exists = p => fs.existsSync(path.join(root, p));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readJSON = p => JSON.parse(read(p));
const readOpt = (p, d) => (exists(p) ? readJSON(p) : d);
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true });
  fs.writeFileSync(path.join(out, p), s);
};
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

// ---- 検査 ----
const { errors, warnings, translations } = validate();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
translations.forEach(x => console.log(x));
warnings.forEach(w => console.log(`注意: ${w}`));

// ---- 読み込み ----
const config = readJSON('config.json');
const baseUrl = config.baseUrl.replace(/\/?$/, '/');
const base = new URL(baseUrl).pathname; // 例: /semicon-quiz/ または /
const langs = config.languages;
const defLang = langs[0].code;
// 検索エンジンに既定として伝える言語(x-default)。ほかの言語のページには、この言語版への案内を出す
const mainLang = config.mainLang ?? defLang;
const mainL = langs.find(x => x.code === mainLang);
const mainS = { ...readJSON(`src/i18n/${defLang}.json`), ...readOpt(`src/i18n/${mainLang}.json`, {}) };
const exams = readJSON('data/exams.json');
const categories = readJSON('data/categories.json');
const glossary = readJSON('data/glossary.json');
// 用語ページのURL(/term/{slug}/)。英語の用語名から作る(glossary.json の slug で上書きできる)
const gloEn = readOpt('data/i18n/en/glossary.json', {});
const termSlug = Object.fromEntries(glossary.map(g => [g.term, g.slug
  ?? (gloEn[g.term]?.term ?? g.term).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]));
const catByLang = Object.fromEntries(langs.slice(1).map(x => [x.code, readOpt(`data/i18n/${x.code}/categories.json`, {})]));
// 用語ページは、訳のある言語でだけ作る(訳のない語を日本語のまま出さない)
const gloByLang = Object.fromEntries(langs.slice(1).map(x => [x.code, readOpt(`data/i18n/${x.code}/glossary.json`, {})]));
const termLangs = key => langs.filter(x => x.code === defLang || gloByLang[x.code][key]);
// 英語の用語名の短い形(タイトル用)。「DRAM (dynamic …)」は DRAM、「Address space … (ASLR)」は ASLR、「Silane (SiH4)」は Silane
const enLabel = key => {
  const en = gloEn[key]?.term;
  const m = en?.match(/^(.*?)\s*\((.+?)\)/);
  if (!m) return en;
  const acr = s => /^[A-Z0-9][A-Z0-9\-/]+$/.test(s);
  return acr(m[1]) || !acr(m[2]) ? m[1] : m[2];
};
// サイトごとの文言(面接・解説・職種・対訳表など)。data/site.json がなければ、その機能のページは作らない
const site = readOpt('data/site.json', {});
const courses = readOpt('data/courses.json', []);
const lastmodPrev = readOpt('data/lastmod.json', {}); // 前回までの更新日(構造化データの dateModified に使う)
// 技術面接でよく問われる質問の一覧(/interview-questions/)。既存の問題から、トピックごとに基本の問題を集める(日本語・英語・繁体字)
const interviewTopics = site.interviewTopics ?? [];
const interviewPer = 8;
const interviewText = interviewTopics.length ? site.interviewText ?? {} : {};
// 「微細化の先へ」(src/pages/{言語}/beyond-scaling.html)へのリンクの文言。関係する分野のページからもリンクする
const beyondText = site.beyondText ?? {};
const beyondCats = site.beyondCats ?? [];
// やさしい解説(/learn/): 初心者が素朴な疑問から読む記事。本文は src/learn/{言語}/{slug}.html(先頭のコメントに JSON の情報)。
// シリーズは data/learn.json。記事のある言語だけに一覧と記事のページを作る(企画: research/2026-10-23-articles-plan.md)
const learnData = readOpt('data/learn.json', { series: [], extra: [] });
const learnNames = code => (exists(`src/learn/${code}`) ? fs.readdirSync(path.join(root, `src/learn/${code}`)).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5)) : []);
const learnText = site.learnText ?? {};
const learnFill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
// 用語の対訳クイズ(モード terms)の文言と、出題する言語の組(対訳表のある言語だけ)
const termQuizText = {
  ja: { question: '「{term}」は{lang}で何と言いますか?', answer: '「{a}」は{lang}で「{b}」です。', langs: { ja: '日本語', en: '英語', 'zh-hant': '中国語(繁体字)' },
    pairs: [['ja', 'en'], ['en', 'ja'], ['ja', 'zh-hant']], heading: '対訳クイズで確かめる', lead: '対訳表の語から10問を出題します。同じ分野の語がまぎらわしい選択肢になります。', arrow: '{from} → {to}' },
  en: { question: 'What is “{term}” in {lang}?', answer: '“{a}” in {lang} is “{b}”. ', langs: { en: 'English', ja: 'Japanese', 'zh-hant': 'Chinese (Traditional)' },
    pairs: [['en', 'zh-hant'], ['en', 'ja'], ['zh-hant', 'en']], heading: 'Test yourself with a translation quiz', lead: 'Ten questions drawn from the terms on this page, with look-alike terms from the same field as distractors.', arrow: '{from} → {to}' },
  'zh-hant': { question: '「{term}」的{lang}是什麼？', answer: '「{a}」的{lang}是「{b}」。', langs: { 'zh-hant': '中文', en: '英文', ja: '日文' },
    pairs: [['en', 'zh-hant'], ['zh-hant', 'en'], ['zh-hant', 'ja']], heading: '用對照測驗確認', lead: '從對照表的術語中出10題，以同一領域的術語作為容易混淆的選項。', arrow: '{from} → {to}' },
};
// 職種ガイド(/careers/ と /careers/{id}/)。仕事の内容と、身につけたい分野・コース・用語。訳は data/i18n/{言語}/careers.json(訳のある言語だけ作る)
const careers = readOpt('data/careers.json', []);
const carByLang = Object.fromEntries(langs.slice(1).map(x => [x.code, readOpt(`data/i18n/${x.code}/careers.json`, {})]));
const carLangs = id => langs.filter(x => careerText[x.code] && (x.code === defLang || carByLang[x.code][id]));
const careerText = site.careerText ?? {};
// 日英中の用語対訳表(/glossary/trilingual/)を作る言語と、その文言
const dictLangs = ['ja', 'en', 'zh-hant'].every(c => langs.some(x => x.code === c)) && glossary.length ? ['ja', 'en', 'zh-hant'] : [];
const dictText = site.dictText ?? {};
// 「Numbers Every Chip Engineer Should Know」(英語のみ。/en/numbers/)。各数値に根拠の問題IDを付ける
const numbers = readOpt('data/numbers.json', []);
const numbersLang = 'en';
const numbersQ = [...new Set(numbers.flatMap(g => g.items.flatMap(x => x.questions ?? [])))];
// 計算ツール(/tools/{slug}/)。data/tools/*.json に1ツール1ファイル(order 順)。文言は言語ごとで、訳のある言語だけページを作る
const tools = exists('data/tools') ? fs.readdirSync(path.join(root, 'data/tools')).filter(f => f.endsWith('.json'))
  .map(f => readJSON(`data/tools/${f}`)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
const toolsIn = code => tools.filter(x => x.text[code]);
const compares = readOpt('data/compare.json', []); // 用語の違い比較ページ(/compare/{slug}/)。英語などの訳は data/i18n/{言語}/compare.json
// ニュースに出た用語(/news-terms/)。用語集の語に「なぜ今話題なのか」などを足す。訳は data/i18n/{言語}/news-terms.json
const newsTerms = readOpt('data/news-terms.json', []);
const figs = figures();
// 操作できる図解(図IDごと。動きは fig-live.js)。文言は言語ごとで、訳のある言語だけ出す
const figLive = readOpt('data/figures-live.json', {});
// 図を単独のSVGファイルとして出す(画像検索用)ときのスタイル。サイトのCSSの色と、`.fig` の規則から作る
const siteCss = read('src/css/style.css');
const cssVars = block => [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => `${m[1]}:${m[2].trim()}`).join(';');
const figStyle = `:root{${cssVars(siteCss.match(/:root \{([\s\S]*?)\n\}/)[1])}}`
  + `@media (prefers-color-scheme: dark){:root{${cssVars(siteCss.match(/prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/)[1])}}}`
  + 'text{font-family:system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}'
  + siteCss.split('\n').filter(l => /^\.fig [^{]+\{/.test(l) && !/^\.fig svg/.test(l)).map(l => l.replace(/^\.fig /, '').replace(/font-family:\s*inherit;?/, '')).join('');
const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const figTitle = svg => xmlText((svg.match(/<title>([^<]*)<\/title>/) || [, ''])[1]);
const figSize = svg => (svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/) || [, 600, 300]).slice(1).map(Number);
// 単独で開いても色が付き(ダークモードにも対応)、背景もあるSVGにする
function standaloneSvg(svg) {
  const [w, h] = figSize(svg);
  return svg.replace(/^(<svg[^>]*>)/, `$1<style>${figStyle}</style><rect width="${w}" height="${h}" style="fill:var(--surface)"/>`);
}
const layout = read('src/templates/layout.html');
const catTpl = read('src/templates/category.html');
const qTpl = read('src/templates/question.html');

const questions = {};
const CODE_ABOVE = /(?<!以)上の/;
// 問題文が「図の回路」「図(a)の…」のように図を見て答える問題(「管理図」「図示」などは除く)
const FIG_ABOVE = /(?<![\u4e00-\u9fff\u30a0-\u30ff])図[のにで中(]/;
for (const c of categories) {
  const qs = readOpt(`data/questions/${c.id}.json`, []);
  questions[c.id] = qs.filter(q => q.reviewed || !config.onlyReviewed);
}

// modes/ のファイルを全部読み込む(ファイルを足せばモードが増える)
const modeDir = path.join(root, 'src/js/modes');
const modes = [];
for (const f of fs.readdirSync(modeDir).filter(f => f.endsWith('.js') && f !== 'index.js')) {
  const m = (await import(pathToFileURL(path.join(modeDir, f)))).default;
  modes.push({ ...m, file: f });
}
modes.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
// 言語コード → その言語で問題ページを作る問題IDの集合(既定言語はすべて、ほかは翻訳があるものだけ)
const hasQ = Object.fromEntries(langs.map(L => [L.code, new Set(categories.flatMap(c => L.code === langs[0].code
  ? questions[c.id].map(q => q.id)
  : Object.keys(readOpt(`data/i18n/${L.code}/questions/${c.id}.json`, {}))))]));
// 広告(AdSense)とアクセス解析(GA4)のタグ。config で未設定なら何も出さない
const adsenseTag = config.adsenseClient
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(config.adsenseClient)}" crossorigin="anonymous"></script>`
  : '';
const ga4Tag = config.ga4Id
  ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(config.ga4Id)}"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments); } gtag('js', new Date()); gtag('config', '${esc(config.ga4Id)}');</script>`
  : '';
const loc = (v, code) => (v && typeof v === 'object' ? v[code] ?? v[defLang] : v);

// ---- 出力先を作り直す ----
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src/css'), path.join(out, 'css'), { recursive: true });
fs.cpSync(path.join(root, 'src/js'), path.join(out, 'js'), { recursive: true });
// 外部のライブラリ(SQL 練習ツールの sql.js など)。大きいので Service Worker の事前保存(js/)には入れない
if (exists('src/vendor')) fs.cpSync(path.join(root, 'src/vendor'), path.join(out, 'vendor'), { recursive: true });
write('js/modes/index.js',
  modes.map((m, i) => `import m${i} from './${m.file}';`).join('\n') +
  `\nexport default [${modes.map((_, i) => `m${i}`).join(', ')}];\n`);

// ページの一覧: 言語ごとに src/pages/{言語}/*.html
const pageNames = code => (exists(`src/pages/${code}`) ? fs.readdirSync(path.join(root, `src/pages/${code}`)).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5)) : []);
const pagePath = (L, name) => (name === 'index' ? L.path : `${L.path}${name}/`);

const sitemap = [];
// hreflang の後始末用: noindex のページと、hreflang を出したページ(出力先と相手のパス)
const noindexPaths = new Set();
const hreflangPages = [];
for (const L of langs) buildLang(L);
// hreflang の相手が noindex のページ(その言語では問題に出てこない用語など)なら、その相手を外す。
// noindex のページを指す hreflang は検索エンジンに「戻りリンクがない」誤りとして扱われるため
for (const { file, targets } of hreflangPages) {
  const drop = targets.filter(x => noindexPaths.has(x));
  if (!drop.length) continue;
  let s = fs.readFileSync(path.join(out, file), 'utf8');
  for (const x of drop) s = s.split('\n').filter(line => !(line.startsWith('<link rel="alternate" hreflang=') && line.endsWith(` href="${baseUrl}${x}">`))).join('\n');
  fs.writeFileSync(path.join(out, file), s);
}

function buildLang(L) {
  const code = L.code;
  const isDef = code === defLang;
  // UI文言の {{brand_xxx}} は、config.json の brand(言語ごと)で埋める(分野名など、サイトごとに違う言葉)
  const brand = loc(config.brand ?? {}, code) ?? {};
  const fillBrand = v => (typeof v === 'string' ? v.replace(/\{\{brand_(\w+)\}\}/g, (m, k) => brand[k] ?? m) : v);
  const S = Object.fromEntries(Object.entries({ ...readJSON(`src/i18n/${defLang}.json`), ...readOpt(`src/i18n/${code}.json`, {}) }).map(([k, v]) => [k, fillBrand(v)]));
  // {n|question|questions} は n が 1 のとき前、それ以外は後ろの語にする(英語などの単数・複数)
  const t = (k, vars = {}) => (S[k] ?? k)
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, x, one, many) => (x in vars ? (Number(vars[x]) === 1 ? one : many) : m))
    .replace(/\{(\w+)\}/g, (m, x) => (x in vars ? vars[x] : m));
  const tr = kind => (isDef ? {} : readOpt(`data/i18n/${code}/${kind}.json`, {}));
  const exT = tr('exams');
  const catT = tr('categories');
  const gloT = tr('glossary');
  const figT = tr('figures');
  // ニュース用語: 日付・問題・リンク先は既定言語のファイルのものを使い、文章だけ訳で置き換える(訳がなければその言語では出さない)
  const nwT = tr('news-terms');
  const news = newsTerms.filter(e => isDef || nwT[e.term]).map(e => {
    const x = isDef ? {} : nwT[e.term];
    return { ...e, label: x.label ?? e.label, short: x.short ?? e.short, background: x.background ?? e.background, diff: x.diff ?? e.diff,
      why: e.why.map((w, i) => ({ ...w, text: isDef ? w.text : x.why?.[i] })) };
  }).sort((a, b) => b.period[1].localeCompare(a.period[1]) || b.period[0].localeCompare(a.period[0]));
  const newsOf = key => news.find(e => e.term === key);
  const home = base + L.path;
  const siteName = loc(config.siteName, code);
  // モード名: 翻訳ファイルの mode_{id}_label などがあればそれを、なければモードのファイルに書いたものを使う
  const modeText = (m, k) => S[`mode_${m.id}_${k}`] ?? loc(m[k], code);

  const exName = e => exT[e.id]?.name ?? e.name;
  const grName = (e, g) => exT[e.id]?.groups?.[g.id] ?? g.name;
  const cats = categories.map(c => ({ ...c, ...(catT[c.id] || {}) }));
  const catOf = id => cats.find(c => c.id === id);
  const groupOf = c => {
    const e = exams.find(x => x.id === c.exam);
    return { exam: e, name: grName(e, e.groups.find(g => g.id === c.group)) };
  };

  // ---- データ ----
  const qs = {};
  for (const c of categories) {
    const tq = isDef ? {} : readOpt(`data/i18n/${code}/questions/${c.id}.json`, {});
    // choiceNotes は訳がある言語だけで表示する(既定言語の補足が混ざらないように)
    // 図(figure)は、この言語の文字にした SVG を figureSvg として渡す(訳が足りなければ出さない)
    qs[c.id] = questions[c.id].filter(q => isDef || tq[q.id]).map(({ reviewed, source, choiceNotes, figure, ...q }) => {
      const figureSvg = figure ? localizeFigure(figs[figure], figT[figure], isDef) : null;
      // 問題文が「上のコード」と書いている問題は、コードを問題文の前に出す(既定言語の問題文で判定し、すべての言語で同じにする)
      const codeFirst = q.code && CODE_ABOVE.test(q.question) ? { codeFirst: true } : {};
      // 図を見て答える問題は、図を解説ではなく問題文のすぐ下に出す(判定は既定言語の問題文で)
      const figureFirst = figureSvg && FIG_ABOVE.test(q.question) ? { figureFirst: true } : {};
      return { ...q, ...codeFirst, ...figureFirst, ...(isDef ? { choiceNotes } : {}), ...(tq[q.id] || {}), ...(figureSvg ? { figureSvg, figureId: figure } : {}) };
    });
    write(`data/${code}/q/${c.id}.json`, JSON.stringify(qs[c.id]));
  }
  // 問題がまだない分野(準備中)は、一覧・コース・分野数から外す。分野ページだけは「準備中」で作る(noindex)
  const live = cats.filter(c => qs[c.id].length);
  // 用語集。key(既定言語の用語名)を言語共通のアンカーIDにする
  // 詳しい解説(about)とよくある質問(faq)は言語ごとに持つ。既定言語の分がほかの言語のページに混ざらないよう外す
  // 検索結果用のタイトル・説明文(title・description)も言語ごと。書いてある語だけ、決まった形の代わりに使う
  // 別表記(aliases)も言語ごと。問題文が「CMOSイメージセンサ」のように別の書き方をしていても用語ページにつなぐ
  const terms = glossary.filter(g => isDef || gloT[g.term]).map(({ about, faq, title, description, aliases, ...g }) => ({ ...g, ...(isDef ? { about, faq, title, description, aliases } : {}), ...(gloT[g.term] || {}), key: g.term, reading: gloT[g.term] ? '' : g.reading }));
  // やさしい解説の記事(情報だけ先に読む。本文はページ生成のところで組み立てる)。読む時間は本文の長さから出す
  const LT = learnText[code];
  const learnArts = (LT ? learnNames(code) : []).map(slug => {
    const src = read(`src/learn/${code}/${slug}.html`);
    const m = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->/);
    if (!m) throw new Error(`src/learn/${code}/${slug}.html: 先頭に JSON のコメントがありません`);
    const a = { slug, ...JSON.parse(m[1]), body: src.slice(m[0].length) };
    for (const k of ['title', 'description', 'series', 'order', 'updated', 'cats']) if (a[k] == null) throw new Error(`learn/${code}/${slug}: ${k} がありません`);
    if (!learnData.series.some(s => s.id === a.series)) throw new Error(`learn/${code}/${slug}: data/learn.json にないシリーズ ${a.series}`);
    for (const id of a.cats) if (!categories.some(c => c.id === id)) throw new Error(`learn/${code}/${slug}: 存在しない分野 ${id}`);
    for (const k of a.terms ?? []) if (!glossary.some(g => g.term === k)) throw new Error(`learn/${code}/${slug}: 用語集にない語 ${k}`);
    const plain = a.body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>|\{\{[^}]*\}\}/g, '');
    a.minutes = Math.max(1, Math.round(['ja', 'zh-hant', 'ko'].includes(code) ? plain.replace(/\s/g, '').length / 500 : plain.split(/\s+/).length / 200));
    return a;
  }).sort((a, b) => learnData.series.findIndex(s => s.id === a.series) - learnData.series.findIndex(s => s.id === b.series) || a.order - b.order);
  const learnByTerm = new Map(learnArts.flatMap(a => (a.terms ?? []).map(k => [k, a])).reverse());
  const learnOfCat = id => learnArts.filter(a => a.cats.includes(id));
  const glossaryIndex = terms.map(g => ({ id: g.key, term: g.term, slug: termSlug[g.key], ...(g.aliases?.length ? { aliases: g.aliases } : {}), ...(g.noLinkIn ? { noLinkIn: g.noLinkIn } : {}), ...(g.linkOnlyIn ? { linkOnlyIn: g.linkOnlyIn } : {}) }));
  const matcher = termMatcher(glossaryIndex);
  // 別の意味で使う分野ではリンクしない用語(用語集の noLinkIn。例: 回路のハンドシェイクを、ネットワークの問題ではリンクしない)
  const skipCache = new Map();
  // linkOnlyIn: その分野の問題でだけリンクする(ほかの言語ではふつうの語になる用語。言語ごとの訳で上書きできる)
  const skipIn = cat => cat && (skipCache.get(cat) ?? skipCache.set(cat, new Set(terms.filter(g => g.noLinkIn?.includes(cat) || (g.linkOnlyIn && !g.linkOnlyIn.includes(cat))).map(g => g.key))).get(cat));
  write(`data/${code}/index.json`, JSON.stringify({
    lang: code,
    locale: L.locale,
    siteName,
    strings: S,
    exams: exams.map(e => ({ id: e.id, name: exName(e), groups: e.groups.map(g => ({ id: g.id, name: grName(e, g) })) })),
    categories: live.map(c => ({ id: c.id, exam: c.exam, group: c.group, name: c.name, count: qs[c.id].length })),
    glossary: glossaryIndex,
    numbersQ,
    modes: Object.fromEntries(modes.map(m => [m.id, { label: modeText(m, 'label'), empty: modeText(m, 'empty') ?? null }])),
    reportFormUrl: config.reportFormUrl ?? null,
    termQuiz: dictLangs.includes(code) ? termQuizText[code] : null,
  }));
  // 用語の対訳クイズのデータ: 用語ごとに3言語の名前と、この言語での短い説明
  if (dictLangs.includes(code)) {
    write(`data/${code}/terms.json`, JSON.stringify(terms.filter(g => dictLangs.every(x => x === defLang || gloByLang[x][g.key]))
      .map(g => ({ k: g.key, c: g.cat, n: Object.fromEntries(dictLangs.map(x => [x, x === defLang ? g.key : gloByLang[x][g.key].term])), d: g.desc }))));
  }
  // PWA のマニフェスト(言語ごと。ホーム画面から開くとその言語のトップになる)
  write(`${L.path}manifest.json`, JSON.stringify({
    name: siteName,
    short_name: siteName,
    lang: L.htmlLang,
    start_url: home,
    scope: base,
    display: 'standalone',
    background_color: '#f5f8fb',
    theme_color: '#1d64c8',
    icons: [
      { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2));

  // ---- HTML部品 ----
  const quizUrl = (m, cat) => `${home}quiz/?mode=${m.id}${cat ? `&amp;c=${cat}` : ''}`;
  const catCards = list => '<ul class="cat-grid">' + list.map(c => `
  <li><a class="cat-card" href="${home}c/${c.id}/">
    <span class="cat-name">${esc(c.name)}</span>${c.blurb ? `
    <span class="cat-blurb">${esc(c.blurb)}</span>` : ''}
    <span class="cat-meta"><span>${t('n_questions', { n: qs[c.id].length })}</span><span class="cat-rate" hidden>${t('rate_label')} <b data-rate="${c.id}"></b></span></span>
    <span class="meter" hidden><span class="meter-bar" data-progress="${c.id}:${qs[c.id].length}" style="width:0%"></span></span>
  </a></li>`).join('') + '</ul>';
  const modeCards = (list, cat) => '<div class="mode-grid">' + list.map((m, i) => `
  <a class="mode-card${i === 0 ? ' primary' : ''}" href="${quizUrl(m, cat)}" rel="nofollow">
    <strong>${esc(modeText(m, 'label'))}</strong><span>${esc(modeText(m, 'desc'))}</span>
  </a>`).join('') + '</div>';
  // トップの開始ボタン。「クイズを始める」は初心者向けコースの最初の分野の10問(コースがなければ全分野から10問)。
  // 学習履歴があれば progress.js が下に「続き・今日の復習・苦手問題」を出す(保存できない環境では出さない)
  const introCourse = courses.find(co => co.id === 'intro');
  const firstCat = introCourse?.steps.find(id => qs[id]?.length);
  const startHref = firstCat ? `${home}quiz/?mode=category&amp;c=${firstCat}&amp;n=10` : `${home}quiz/?mode=random`;
  const startCard = (href, title, desc, extra = '') => `<a class="start-card" href="${href}"${extra}><strong>${title}</strong><span>${desc}</span></a>`;
  const startPanel = `<div class="hero-cta">
    <a class="btn btn-primary btn-lg" href="${startHref}" rel="nofollow" data-track="home_start_quiz">${esc(t('home_cta_start'))}</a>
    <a class="btn btn-ghost btn-lg" href="#topics" data-track="home_pick_topic">${esc(t('home_cta_pick'))}</a>
  </div>
  <p class="hero-note">${esc(t('home_cta_note'))}</p>`;
  const startBack = `<section class="start" data-start="back" hidden>
  <h2>${esc(t('home_back_heading'))}</h2>
  <div class="start-grid" data-cats="${esc(JSON.stringify(Object.fromEntries(live.map(c => [c.id, c.name]))))}">
    ${startCard(`${home}quiz/?mode=category&amp;n=10`, esc(t('start_continue')), esc(t('start_continue_desc')), ' rel="nofollow" data-continue data-track="home_continue"')}
    ${startCard(`${home}quiz/?mode=review`, esc(t('start_review')), esc(t('start_review_desc')), ' rel="nofollow" data-due hidden data-track="home_review"')}
    ${startCard(`${home}quiz/?mode=weak`, esc(t('start_weak')), esc(t('start_weak_desc')), ' rel="nofollow" data-weak hidden data-track="home_weak"')}
  </div>
</section>`;
  // トップの「できること」: メニューを開かなくても主な機能が分かるカード(実在するページだけ。見出しはヘッダーの名前とそろえる)
  const feature = (href, title, desc, track) => `<a class="feature-card" href="${href}" data-track="${track}"><strong>${esc(title)}</strong><span>${esc(desc)}</span></a>`;
  const homeFeatures = `<section class="features" aria-labelledby="features-h">
  <h2 id="features-h" class="visually-hidden">${esc(t('home_feat_heading'))}</h2>
  <div class="feature-grid">
    ${feature('#topics', S.nav_topics, t('home_feat_topics_desc', { n: live.length }), 'home_feat_topics')}
    ${learnArts.length ? feature(`${home}learn/`, LT.nav, LT.card, 'home_feat_learn') : ''}
    ${courses.length ? feature('#courses', S.course_heading, t('home_feat_courses_desc'), 'home_feat_courses') : ''}
    ${feature(`${home}glossary/`, S.nav_glossary, t('home_feat_glossary_desc'), 'home_feat_glossary')}
    ${dictLangs.includes(code) ? feature(`${home}glossary/trilingual/`, dictText[code].nav, dictText[code].card, 'home_feat_dict') : ''}
    ${careerText[code] && careers.some(x => isDef || carByLang[code][x.id]) ? feature(`${home}careers/`, careerText[code].nav, careerText[code].card, 'home_feat_careers') : ''}
    ${interviewText[code] ? feature(`${home}interview-questions/`, interviewText[code].nav, interviewText[code].card, 'home_feat_interview') : ''}
    ${beyondText[code] && pageNames(code).includes('beyond-scaling') ? feature(`${home}beyond-scaling/`, beyondText[code].nav, beyondText[code].card, 'home_feat_beyond') : ''}
    ${compares.some(e => isDef || tr('compare')[e.slug]) ? feature(`${home}compare/`, S.nav_compare, t('home_feat_compare_desc'), 'home_feat_compare') : ''}
    ${Object.keys(figs).length ? feature(`${home}figures/`, S.footer_figures, t('home_feat_figures_desc'), 'home_feat_figures') : ''}
    ${toolsIn(code).length ? feature(`${home}tools/`, S.nav_tools, t('home_feat_tools_desc'), 'home_feat_tools') : ''}
    ${news.length ? feature(`${home}news-terms/`, S.news_title, t('home_feat_news_desc'), 'home_feat_news') : ''}
  </div>
</section>`;
  // 分野の選び方: 大きな区分(半導体 / コンピュータ・IT) → 大分類(開閉できる行) → 分野(1行ずつ)。
  // トップでは大分類を閉じておき(分野が増えても縦に伸びない)、分野一覧 /c/ では開いて並べる。分野名は閉じていても HTML にある
  const examGroups = e => e.groups.map(g => ({ g, list: live.filter(c => c.exam === e.id && c.group === g.id) })).filter(x => x.list.length);
  const listSep = ['ja', 'zh-hant'].includes(code) ? '、' : ', ';
  const topicRows = (list, track) => '<ul class="topic-rows">' + list.map(c => `
      <li><a href="${home}c/${c.id}/"${track ? ` data-track="${track}"` : ''}><span class="tr-name">${esc(c.name)}</span><span class="tr-meta">${t('n_questions', { n: qs[c.id].length })}<span class="cat-rate" hidden> · <b data-rate="${c.id}"></b></span></span>
        <span class="meter" hidden><span class="meter-bar" data-progress="${c.id}:${qs[c.id].length}" style="width:0%"></span></span></a></li>`).join('') + '</ul>';
  const topicBrowser = open => exams.filter(e => examGroups(e).length).map(e => `
<section class="topic-area">
  <h3 class="area-title">${esc(exName(e))}</h3>
  ${examGroups(e).map(({ g, list }) => `<details class="topic-group" id="g-${e.id}-${g.id}"${open ? ' open' : ''}>
    <summary><span class="tg-name">${esc(grName(e, g))}</span><span class="tg-meta">${esc(t('course_steps_n', { n: list.length }))} · ${esc(t('n_questions', { n: list.reduce((s, c) => s + qs[c.id].length, 0) }))}</span><span class="tg-preview">${esc(list.slice(0, 4).map(c => c.name).join(listSep))}${list.length > 4 ? ' …' : ''}</span></summary>
    ${topicRows(list, open ? '' : 'home_topic_row')}
  </details>`).join('\n  ')}
</section>`).join('');
  const categoryList = `<section id="topics" class="topics">
  <h2>${esc(t('exam_heading'))}</h2>${topicBrowser(false)}
  <p class="topics-all"><a href="${home}c/">${esc(t('topics_all_link', { n: live.length }))} →</a></p>
</section>`;

  terms.sort((a, b) => (isDef ? a.reading.localeCompare(b.reading, 'ja') : a.term.localeCompare(b.term, L.locale)));
  // 用語集は試験の区分 → 分野の順にまとめる(分野の中は読み順)。上に分野へのジャンプ用リンクを置く
  const termItem = g => `
    <div class="term" id="${esc(g.key)}">
      <dt><a href="${home}term/${termSlug[g.key]}/">${esc(g.term)}</a>${g.reading ? `<small>${esc(g.reading)}</small>` : ''}</dt>
      <dd>${esc(g.desc)}</dd>
    </div>`;
  const gloGroups = exams.flatMap(e => e.groups.map(g => ({
    name: grName(e, g),
    cats: cats.filter(c => c.exam === e.id && c.group === g.id)
      .map(c => ({ c, list: terms.filter(x => x.cat === c.id) })).filter(x => x.list.length),
  }))).filter(g => g.cats.length);
  // 分野ごとに開閉できる欄にする(1,000語を超えて縦に長くなりすぎるため)。説明文は閉じていても HTML にあり、検索で開く(glossary.js)
  const glossaryList = gloGroups.map(g => `
<section class="glossary-group">
  <h2>${esc(g.name)}</h2>${g.cats.map(({ c, list }) => `
  <details class="glossary-cat" id="cat-${c.id}">
    <summary><span class="tg-name">${esc(c.name)}</span><span class="tg-meta">${list.length}</span></summary>
    <p class="glossary-cat-quiz"><a href="${home}c/${c.id}/">${esc(t('glossary_to_quiz'))}</a></p>
    <dl class="glossary">${list.map(termItem).join('')}
    </dl>
  </details>`).join('')}
</section>`).join('') + (terms.some(g => !catOf(g.cat)) ? `
<dl class="glossary">${terms.filter(g => !catOf(g.cat)).map(termItem).join('')}</dl>` : '');

  // 問題ページ用
  const mark = n => String.fromCharCode(65 + n);
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const qUrl = (cat, id, l = L) => `${l.path}q/${cat}/${id}/`;
  // 問題ページのタイトル。問題文の頭が同じ問題で重ならないように、重なったら長めに出し、それでも重なれば番号を添える
  const qTitles = new Set();
  const qTitle = (c, q) => {
    const make = len => t('question_title', { name: c.name, q: short(q.question, len) });
    let title = [50, 80, 120].map(make).find(x => !qTitles.has(x)) ?? `${make(50)} (${q.id.split('-').pop()})`;
    qTitles.add(title);
    return title;
  };
  const linked = (text, cat) => linkTerms(text, matcher, skipIn(cat)).map(p => (typeof p === 'string' ? esc(p)
    : `<a class="term-link" href="${home}term/${termSlug[p.id]}/">${esc(p.text)}</a>`)).join('');
  const reportLink = id => (config.reportFormUrl
    ? `<p class="q-report"><a class="report-link" href="${esc(reportUrl(config.reportFormUrl, id, code))}" target="_blank" rel="noopener nofollow">${esc(t('report_error'))}</a></p>`
    : '');
  const qLinks = list => '<ol class="q-list">' + list.map(q => `
  <li${q.level ? ` data-level="${q.level}"` : ''}><a href="${base}${qUrl(q.cat, q.id)}">${esc(q.question)}</a></li>`).join('') + '</ol>';
  // 難易度の絞り込みボタン(level のある問題があるときだけ。動きは level.js)
  const levelFilter = list => (list.some(q => q.level) ? `<div class="level-filter" role="group">${
    ['', 1, 2, 3].map(lv => `<button type="button" class="chip" data-level-btn="${lv}"${lv ? '' : ' aria-pressed="true"'}>${esc(t(`level_${lv || 'all'}`))}</button>`).join('')}</div>` : '');
  const choiceNotes = q => (q.choiceNotes ? '<ul class="choice-notes">' + q.choiceNotes.map((note, k) =>
    (note ? `<li><b>${mark(k)}. </b>${esc(note)}</li>` : '')).join('') + '</ul>' : '');

  // 静的な問題ブロック(個別問題・用語・比較ページ)を、その場で解けるようにするための属性(動きは answer.js)
  const qData = q => ` data-qid="${esc(q.id)}" data-cat="${esc(q.cat)}" data-answer="${q.answer}" data-correct="${esc(t('correct'))}" data-incorrect="${esc(t('incorrect', { mark: mark(q.answer) }))}"`;

  // 用語ページの説明文(検索結果に出る): 文の途中で「…」と切らず、収まる文までにする。
  // 余裕があれば練習問題の数を添える(検索から来た人に、解ける問題があることを伝える)
  const termDescription = (desc, n) => {
    const sentences = desc.match(/(?:[^。.!?！？]|[.!?](?!\s|$))+(?:[。！？]|[.!?](?=\s|$)|$)\s*/g) ?? [desc];
    let text = '';
    for (const x of sentences) {
      if ((text + x).trim().length > 150) break;
      text += x;
    }
    text = text.trim() || short(desc, 150);
    const more = n ? t('term_desc_more', { n }) : '';
    const sep = /[。！？]$/.test(text) ? '' : ' '; // 日本語・中国語は句点のあとに空白を入れない
    return more && text.length + more.length + 1 <= 160 ? `${text}${sep}${more}` : text;
  };

  // 学習コース: トップの一覧と /course/{id}/ のページ(進み具合の表示は course.js)
  // コースの分野のうち、問題がまだない分野は準備ができるまで外す
  // 名前の訳がない言語(新しい内容を日英繁だけで足したコースなど)では、そのコースを出さない
  const liveCourses = courses.filter(co => typeof co.name !== 'object' || co.name[code]).map(co => ({ ...co, steps: co.steps.filter(id => qs[id]?.length) })).filter(co => co.steps.length);
  const courseList = liveCourses.length ? `<section id="courses">
  <h2>${esc(t('course_heading'))}</h2>
  <p class="muted">${esc(t('course_lead'))}</p>
  <div class="course-grid">${liveCourses.map(co => `
  <a class="course-card" href="${home}course/${co.id}/" data-course-card="${co.steps.map(id => `${id}:${qs[id].length}`).join(' ')}">
    <strong>${esc(loc(co.name, code))}</strong>
    <span>${esc(loc(co.desc, code))}</span>
    <span class="course-meta"><span>${esc(t('course_steps_n', { n: co.steps.length }))}</span><b data-course-done></b></span>
    <span class="meter"><span class="meter-bar" style="width:0%"></span></span>
  </a>`).join('')}
  </div>
</section>` : '';

  // ---- 用語の違い比較 ----
  const cmpT = tr('compare');
  const cmp = compares.filter(e => isDef || cmpT[e.slug]).map(e => ({ ...e, ...(isDef ? {} : cmpT[e.slug]) }));
  const qById = new Map(categories.flatMap(c => qs[c.id].map(q => [q.id, { ...q, cat: c.id }])));
  const abs = x => new URL(x, baseUrl).href;
  const crumbs = (...items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(url) })) });
  const cmpUrl = e => `${home}compare/${e.slug}/`;
  for (const e of cmp) {
    const where = `data/compare.json「${e.slug}」`;
    if (!e.rows.length || e.rows.some(r => r.length !== e.items.length + 1)) throw new Error(`${where}(${code}): rows の列数が items と合っていません`);
    for (const k of e.terms ?? []) if (!glossary.some(g => g.term === k)) throw new Error(`${where}: 用語集にない語 ${k}`);
    for (const id of e.questions ?? []) if (isDef && !qById.has(id)) throw new Error(`${where}: 存在しない問題 ${id}`);
    if (!catOf(e.cat)) throw new Error(`${where}: 存在しない分野 ${e.cat}`);
    if ((e.faq ?? []).some(f => !Array.isArray(f) || f.length !== 2 || f.some(x => typeof x !== 'string'))) throw new Error(`${where}(${code}): faq は [質問, 答え] の配列にしてください`);
  }
  const cmpCards = list => '<ul class="cmp-list">' + list.map(e => `
  <li><a class="cmp-card" href="${cmpUrl(e)}"><strong>${esc(e.title)}</strong><span>${esc(short(e.description, 110))}</span></a></li>`).join('') + '</ul>';
  // 比較の一覧(用語集と同じ作り): 区分 → 分野の順にまとめる
  const cmpGroups = exams.flatMap(e => e.groups.map(g => ({
    name: grName(e, g),
    cats: cats.filter(c => c.exam === e.id && c.group === g.id)
      .map(c => ({ c, list: cmp.filter(x => x.cat === c.id) })).filter(x => x.list.length),
  }))).filter(g => g.cats.length);
  const cmpItem = e => `
    <div class="term" id="cmp-${esc(e.slug)}">
      <dt><a href="${cmpUrl(e)}">${esc(e.title)}</a></dt>
      <dd>${esc(e.description)}</dd>
    </div>`;
  const compareIndex = `<nav class="glossary-nav" aria-label="${esc(t('glossary_nav'))}">${cmpGroups.map(g => `
  <p><b>${esc(g.name)}</b>${g.cats.map(({ c, list }) => ` <a class="chip" href="#cat-${c.id}">${esc(c.name)} <small>${list.length}</small></a>`).join('')}</p>`).join('')}
</nav>` + cmpGroups.map(g => `
<section class="glossary-group">
  <h2>${esc(g.name)}</h2>${g.cats.map(({ c, list }) => `
  <section class="glossary-cat" id="cat-${c.id}">
    <h3>${esc(c.name)}<a href="${home}c/${c.id}/">${esc(t('glossary_to_quiz'))}</a></h3>
    <dl class="glossary">${list.map(cmpItem).join('')}
    </dl>
  </section>`).join('')}
</section>`).join('');
  const cmpSection = (heading, list) => (list.length ? `<section>
  <h2>${esc(heading)}</h2>
  ${cmpCards(list)}
</section>` : '');

  // ---- 参考書(Amazonアソシエイト): 分野ページに検索リンクを出す。config.amazonTag に言語がなければ出さない ----
  const amazonTag = config.amazonTag?.[code];
  const amazonHost = config.amazonDomain?.[code] || 'www.amazon.co.jp';
  const booksData = isDef ? readOpt('data/books.json', {}) : readOpt(`data/i18n/${code}/books.json`, {});
  const kitsData = readOpt('data/kits.json', {})[code];
  const bookSection = c => {
    if (!amazonTag) return '';
    const kws = booksData[c.id] || [`${t('books_fallback')} ${c.name.replace(/[(（].*?[)）]/g, '')}`];
    const link = (kw, track) => `<li><a href="https://${amazonHost}/s?k=${encodeURIComponent(kw)}&amp;tag=${esc(amazonTag)}" target="_blank" rel="sponsored nofollow noopener" data-track="${track}">${esc(t('books_link', { kw }))}</a></li>`;
    // 手を動かして学べる分野だけ、実習用の部品・キットの検索リンクを添える(data/kits.json。試行中)
    const kit = kitsData?.items?.[c.id];
    return `<section class="books">
  <h2>${esc(t('books_heading', { name: c.name }))} <small class="pr-badge">${esc(t('books_pr'))}</small></h2>
  <ul>${kws.map(kw => link(kw, 'book_link')).join('')}</ul>${kit ? `
  <h3>${esc(kitsData.heading)}</h3>
  <p>${esc(kitsData.note)}</p>
  <ul>${kit.map(kw => link(kw, 'kit_link')).join('')}</ul>` : ''}
  <p class="muted">${esc(t('books_note'))}</p>
</section>`;
  };

  // ---- 図解集(/figures/)と、問題・用語ページの図 ----
  const figList = Object.keys(figs).map(id => ({ id, svg: localizeFigure(figs[id], figT[id], isDef) })).filter(x => x.svg)
    .map(x => ({ ...x, title: figTitle(x.svg), size: figSize(x.svg) }));
  const figUse = {}; // 図ID → その図を使う問題(この言語で出せるもの)
  for (const c of categories) for (const q of questions[c.id]) {
    if (q.figure && qById.has(q.id)) (figUse[q.figure] = figUse[q.figure] || []).push(qById.get(q.id));
  }
  figList.sort((a, b) => (categories.findIndex(c => c.id === figUse[a.id]?.[0]?.cat) + 1 || 999) - (categories.findIndex(c => c.id === figUse[b.id]?.[0]?.cat) + 1 || 999));
  for (const x of figList) write(`img/${code}/${x.id}.svg`, standaloneSvg(x.svg));
  // 操作できる図解の部分。JSが動くまでは隠しておく(静的な図と説明はその上に残る)
  const figLiveHtml = id => {
    const f = figLive[id], x = f?.text[code];
    if (!x) return '';
    const tool = tools.find(y => y.id === f.tool && y.text[code]);
    return `<section class="fig-live" data-fig-live="${id}" data-text="${esc(JSON.stringify(x))}" hidden>
  <h2>${esc(x.heading)}</h2>
  <p>${esc(x.lead)}</p>
  <div class="fig-live-ctl">${f.controls.map(c => `
    <label class="dy-field"><span>${esc(x[`ctl_${c.name}`])}</span><input type="range" id="fl-${id}-${c.name}" name="${c.name}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"><output for="fl-${id}-${c.name}"></output></label>`).join('')}
  </div>
  <div class="fig fig-live-svg"></div>
  <p class="fig-live-state" aria-live="polite"></p>${tool ? `
  <p><a class="btn btn-ghost" data-tool-link href="${home}tools/${tool.slug}/">${esc(x.tool_link)} →</a></p>` : ''}
</section>`;
  };
  // 操作できる版のある図は、図ごとのページ /figures/{図ID}/ を作る(この言語の訳があるものだけ)
  const figPage = id => !!figLive[id]?.text[code] && figList.some(x => x.id === id);
  const figPagePath = (id, l = L) => `${l.path}figures/${id}/`;
  // その図への行き先: 図ごとのページがあればそこ、なければ図解集の中の位置
  const figHref = id => (figPage(id) ? `${base}${figPagePath(id)}` : `${home}figures/#fig-${id}`);
  const figureHtml = (svg, id) => `<figure class="fig">${svg}<figcaption class="fig-cap">${esc(figTitle(svg))} · <a href="${figHref(id)}">${esc(t(figPage(id) ? 'figure_try' : 'figure_open'))}</a></figcaption></figure>`;
  const figureGallery = `<div class="fig-grid">${figList.map(x => `
  <figure class="fig-item" id="fig-${x.id}">
    <img src="${base}img/${code}/${x.id}.svg" alt="${esc(x.title)}" width="${x.size[0]}" height="${x.size[1]}" loading="lazy">
    <figcaption><strong>${figPage(x.id) ? `<a href="${figHref(x.id)}">${esc(x.title)}</a>` : esc(x.title)}</strong>${figPage(x.id) ? `<a class="fig-try" href="${figHref(x.id)}">${esc(t('figure_try'))} →</a>` : ''}${figUse[x.id]?.length ? `<span class="muted">${esc(t('figure_used_in'))}: ${figUse[x.id].slice(0, 2).map(q => `<a href="${base}${qUrl(q.cat, q.id)}">${esc(short(q.question, 48))}</a>`).join(' / ')}</span>` : ''}</figcaption>
  </figure>`).join('')}
</div>`;
  const figureLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': figList.map(x => ({ '@type': 'ImageObject', contentUrl: abs(`${base}img/${code}/${x.id}.svg`), name: x.title, caption: x.title, inLanguage: L.htmlLang })),
  }).replace(/</g, '\\u003c');

  // ---- サイト内検索の索引(検索ページが最初に読み込む。動きは search.js) ----
  const searchItems = [
    ...learnArts.map(a => ({ t: 'l', n: a.title, u: `learn/${a.slug}/`, x: a.description })),
    ...cmp.map(e => ({ t: 'c', n: e.title, u: `compare/${e.slug}/`, x: `${e.description} ${e.items.join(' ')}` })),
    ...terms.map(g => ({ t: 't', n: g.term, u: `term/${termSlug[g.key]}/`, x: `${g.desc} ${isDef ? '' : g.key}` })),
    ...live.map(c => ({ t: 'k', n: c.name, u: `c/${c.id}/`, x: c.description })),
    ...figList.map(x => ({ t: 'f', n: x.title, u: figPage(x.id) ? `figures/${x.id}/` : `figures/#fig-${x.id}`, x: '' })),
    ...live.flatMap(c => qs[c.id].map(q => ({ t: 'q', n: q.question, u: `q/${c.id}/${q.id}/`, x: c.name }))),
  ];
  write(`data/${code}/search.json`, JSON.stringify({
    strings: { ...Object.fromEntries(['search_none', 'search_hint', 'search_more', 'search_count', 'search_g_c', 'search_g_t', 'search_g_k', 'search_g_f', 'search_g_q'].map(k => [k, S[k]])), ...(LT ? { search_g_l: LT.search } : {}) },
    items: searchItems,
  }));

  // 比較ページの「関連する比較」: 共通の用語・同じ分野・同じ区分の近いものを選ぶ
  const relatedCmp = e => {
    const grp = x => catOf(x.cat)?.group;
    return cmp.filter(x => x !== e)
      .map(x => ({ x, s: 2 * (x.terms ?? []).filter(k => (e.terms ?? []).includes(k)).length + (x.cat === e.cat ? 4 : 0) + (grp(x) === grp(e) ? 1 : 0) }))
      .sort((a, b) => b.s - a.s).slice(0, 6).map(r => r.x);
  };

  const common = {
    base, home, lang: code, htmlLang: L.htmlLang,
    siteName: esc(siteName),
    year: new Date().getFullYear(),
    // 問い合わせフォーム: 日本語のページは日本語のフォーム、ほかの言語は(その言語のフォームがなければ)英語のフォーム
    contactFormUrl: esc(config.contactFormUrl && typeof config.contactFormUrl === 'object' ? config.contactFormUrl[code] ?? config.contactFormUrl[code === defLang ? defLang : mainLang] ?? config.contactFormUrl[defLang] : config.contactFormUrl ?? ''),
    categoryList, glossaryList, courseList, compareIndex, figureGallery, figureLd,
    // 404 ページの英語の案内(英語版がなければトップへ)
    enHome: base + (langs.find(x => x.code === 'en')?.path ?? ''),
    siteNameEn: esc(loc(config.siteName, 'en')),
    // サイトについて: 中身のあるコンテンツだけを並べる
    aboutCompare: cmp.length ? `  <li><strong><a href="${home}compare/">${esc(S.nav_compare)}</a></strong>：${esc(t('about_compare'))}</li>\n` : '',
    aboutFigures: figList.length ? `  <li><strong><a href="${home}figures/">${esc(S.footer_figures)}</a></strong>：${esc(t('about_figures'))}</li>\n` : '',
    // トップの開始ボタンの下: 学習コースへの案内(コースの一覧は分野の一覧より下にある)
    courseHint: liveCourses.length ? `<p class="hero-note"><a href="#courses">${esc(t('home_course_hint'))} → ${esc(t('course_heading'))}</a></p>` : '',
    topModes: modeCards(modes.filter(m => m.scope.includes('top'))),
    // トップ下部の「ほかの練習方法」(ランダム10問は上の入口にあるので除く)
    moreModes: modeCards(modes.filter(m => m.scope.includes('top') && m.id !== 'random')).replace('mode-grid', 'mode-grid compact'),
    startPanel, startBack, homeFeatures,
    // 用語集の上に出す、ニュース用語の一覧への案内
    dictLink: dictLangs.includes(code) ? `<p class="news-link"><a class="chip" href="${home}glossary/trilingual/">${esc(dictText[code].h1)}</a></p>` : '',
    newsTermsLink: news.length ? `<p class="news-link"><a class="chip" href="${home}news-terms/">${esc(S.news_title)}</a> <span class="muted">${esc(t('glossary_news_link', { terms: news.slice(0, 3).map(e => e.label ?? terms.find(g => g.key === e.term).term).join(', ') }))}</span></p>` : '',
    // トップ下部の計算ツールの一覧(訳のあるツールだけ)
    toolList: toolsIn(code).length ? `<section>
  <h2><a href="${home}tools/">${esc(S.tools_title)}</a></h2>
  <div class="mode-grid compact">${toolsIn(code).map(y => `<a class="mode-card" href="${home}tools/${y.slug}/"><strong>${esc(y.text[code].h1)}</strong><span>${esc(y.text[code].card)}</span></a>`).join('')}</div>
</section>` : '',
    questionTotal: Object.values(qs).reduce((s, x) => s + x.length, 0),
    categoryTotal: live.length,
    // プライバシーポリシーの「広告・アクセス解析」: 使っているサービスの説明だけを出す
    adsPolicy: [config.adsenseClient && S.policy_adsense, S.policy_affiliate, config.ga4Id && S.policy_ga4].filter(Boolean).map(x => `<p>${x}</p>`).join('\n')
      || `<p>${S.policy_none}</p>`,
    ...Object.fromEntries(Object.entries(S).map(([k, v]) => [`t_${k}`, v])),
    ...Object.fromEntries(Object.entries(brand).map(([k, v]) => [`brand_${k}`, esc(v)])),
  };

  // ---- ページ生成 ----
  // alt: 言語コード → その言語での同じページのパス(なければ省略)
  // fallback: 同じページがない言語へ切り替えるときの行き先(既定はその言語のトップ)
  function page({ path: p, alt, fallback = x => x.path, out: file, title, fullTitle, description, noindex, scripts = [], ads = true, langBanner = true, jsonld = null, content }) {
    const url = baseUrl + p;
    if (config.noindex) noindex = true; // 確認用の公開: 全ページを検索に載せない
    const tt = fullTitle || (title ? `${title} | ${siteName}` : siteName);
    const alts = langs.filter(x => alt[x.code] != null);
    if (noindex) noindexPaths.add(p);
    else if (alts.length) hreflangPages.push({ file: file || `${p}index.html`, targets: alts.map(x => alt[x.code]) });
    const head = [
      // 登録してよいページでは、検索結果や Discover に大きな画像を出してよいことを伝える
      noindex ? '<meta name="robots" content="noindex">' : `<meta name="robots" content="max-image-preview:large">\n<link rel="canonical" href="${url}">`,
      ...(noindex ? [] : alts.map(x => `<link rel="alternate" hreflang="${x.htmlLang}" href="${baseUrl}${alt[x.code]}">`)),
      !noindex && alt[mainLang] != null ? `<link rel="alternate" hreflang="x-default" href="${baseUrl}${alt[mainLang]}">` : '',
      `<meta property="og:type" content="${p === L.path ? 'website' : 'article'}">`,
      `<meta property="og:title" content="${esc(tt)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta property="og:site_name" content="${esc(siteName)}">`,
      `<meta property="og:locale" content="${L.locale.replace('-', '_')}">`,
      `<meta property="og:image" content="${baseUrl}icon-512.png">`, // SNS で共有したときの画像(サイトのアイコン)
      '<meta name="twitter:card" content="summary">',
      `<link rel="manifest" href="${home}manifest.json">`,
      `<link rel="icon" href="${base}icon-192.png" type="image/png">`,
      `<link rel="apple-touch-icon" href="${base}icon-192.png">`,
      jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : '',
      ads ? adsenseTag : '', // クイズ画面(ads:false)には広告を出さない
      ga4Tag,
    ].filter(Boolean).join('\n');
    const langLinks = langs.map(x => x.code === code
      ? `<span aria-current="true" lang="${x.htmlLang}">${esc(x.label)}</span>`
      : alt[x.code] != null
        ? `<a href="${base}${alt[x.code]}" hreflang="${x.htmlLang}" lang="${x.htmlLang}" data-lang="${x.code}">${esc(x.label)}</a>`
        : `<a href="${base}${fallback(x)}" lang="${x.htmlLang}" data-lang="${x.code}">${esc(x.label)}</a>`).join('');
    // ヘッダーのナビ(いまいるページには aria-current を付ける)。
    // PC: Topics / 用語集 / 比較 / 図解 / 計算ツール / Progress。スマートフォン: ホームを加えて Menu に縦に並べる
    const navLink = ([sub, label]) => `<a href="${home}${sub}"${p === L.path + sub ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
    const resources = [...(learnArts.length ? [['learn/', LT.nav]] : []), ['glossary/', S.nav_glossary], ...(cmp.length ? [['compare/', S.nav_compare]] : []), ...(figList.length ? [['figures/', S.footer_figures]] : []),
      ...(numbers.length && code === numbersLang ? [['numbers/', 'Key numbers']] : []),
      ...(toolsIn(code).length ? [['tools/', S.nav_tools]] : [])];
    // 用語集・比較・図解・計算ツールはそれぞれ独立した項目として並べる(PC ではホームはロゴから戻る)
    const headerNav = [['c/', S.nav_topics], ...resources, ['stats/', S.nav_stats]].map(navLink).join('');
    const navMenu = [['', S.nav_home], ['c/', S.nav_topics], ...resources, ['stats/', S.nav_stats]].map(navLink).join('');
    // 既定言語以外のページ: ブラウザの言語がこのページの言語でない人に、既定言語版への案内を出す(閉じたら以後出さない)
    const mainHref = langBanner && code !== mainLang ? base + (alt[mainLang] ?? fallback(mainL)) : null;
    const bannerHtml = mainHref ? `<div class="lang-banner" lang="${mainL.htmlLang}" hidden><div class="wrap"><a href="${mainHref}" hreflang="${mainL.htmlLang}">${esc(mainS.lang_banner)}</a><button type="button" aria-label="${esc(mainS.lang_banner_close)}">×</button></div></div>
<script>(() => { const b = document.currentScript.previousElementSibling, k = 'langBannerClosed', l = document.documentElement.lang.toLowerCase().split('-')[0]; let c; try { c = localStorage.getItem(k) || localStorage.getItem('langChoice'); } catch {} if (c || (navigator.languages || [navigator.language]).some(x => x && x.toLowerCase().startsWith(l))) return; b.hidden = false; b.querySelector('button').onclick = () => { b.hidden = true; try { localStorage.setItem(k, '1'); } catch {} }; })();</script>` : '';
    if (ads) scripts = ['ads.js', ...scripts];
    write(file || `${p}index.html`, fill(layout, {
      ...common,
      title: esc(tt),
      description: esc(description),
      head,
      langLinks,
      langCurrent: esc(L.label),
      langMenuHidden: langs.length < 2 ? ' hidden' : '', // 言語が1つだけのときは切り替えを出さない
      footerFigures: figList.length ? `<a href="${home}figures/">${esc(S.footer_figures)}</a>` : '',
      // 幅の狭いスマートフォンでは言語名を短くして、サイト名の場所を空ける(漢字・ハングルの名前はもともと短い)
      langShort: esc({ en: 'EN', de: 'DE', nl: 'NL', fr: 'FR' }[code] ?? L.label),
      headerNav,
      navMenu,
      langBanner: bannerHtml,
      htmlAttrs: ads && config.adPlaceholders && !config.adsenseClient ? ' data-ad-ph' : ads && config.adsenseClient && config.adsenseSlots ? ` data-adsense-client="${esc(config.adsenseClient)}" data-adsense-slots="${esc(JSON.stringify(config.adsenseSlots))}"` : '',
      content,
      scripts: scripts.map(s => `<script type="module" src="${base}js/${s}"></script>`).join('\n'),
    }));
    // 更新日の判定用に、本文(タイトル・説明・内容)のハッシュを残す。ヘッダーなど全ページ共通の部分は含めない
    if (!noindex) sitemap.push({ url, hash: crypto.createHash('sha1').update(tt + description + content).digest('hex').slice(0, 16) });
  }

  // src/pages/{言語}/*.html(ファイルを足せばページが増える)
  for (const name of pageNames(code)) {
    // 中身のない一覧ページ(比較・図解)は作らない
    if ((name === 'compare' && !cmp.length) || (name === 'figures' && !figList.length)) continue;
    const src = read(`src/pages/${code}/${name}.html`);
    const m = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->/);
    const alt = Object.fromEntries(langs.filter(x => pageNames(x.code).includes(name)).map(x => [x.code, pagePath(x, name)]));
    // トップ: 検索結果のサイト名になる WebSite(各言語のサイト名を別名として添える)
    // あわせて運営者の Organization(サイト名で検索した人にトップを示し、ロゴを伝える)
    const altNames = [...new Set(Object.values(config.siteName))].filter(x => x !== siteName);
    const jsonld = name === 'index' ? [{ '@context': 'https://schema.org', '@type': 'WebSite', name: siteName, url: abs(L.path),
      alternateName: altNames, inLanguage: L.htmlLang },
      { '@context': 'https://schema.org', '@type': 'Organization', name: siteName, alternateName: altNames, url: abs(''), logo: abs('icon-512.png') }] : null;
    page({ path: pagePath(L, name), alt, jsonld, ...JSON.parse(fill(m[1], common)), content: fill(src.slice(m[0].length), common) });
  }

  // やさしい解説: 一覧 /learn/ と記事 /learn/{slug}/。本文の {{fig:図のid}} は図に、{{term:日本語の用語名|表示}} は用語ページへのリンクにする
  if (learnArts.length) {
    const learnAlt = slug => Object.fromEntries(langs.filter(x => learnText[x.code] && learnNames(x.code).includes(slug)).map(x => [x.code, `${x.path}learn/${slug}/`]));
    const seriesName = s => s.name[code] ?? s.name[defLang];
    const seriesOf = a => learnData.series.find(s => s.id === a.series);
    const learnUrl = `${home}learn/`;
    const fmtDay = d => new Intl.DateTimeFormat(L.locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
    // 一覧に載せる既存の読み物(「微細化の先へ」など src/pages のページ)
    const extras = (learnData.extra ?? []).filter(x => pageNames(code).includes(x.page)).map(x => {
      const meta = JSON.parse(fill(read(`src/pages/${code}/${x.page}.html`).match(/^<!--\s*(\{[\s\S]*?\})\s*-->/)[1], common));
      return { ...x, title: meta.title, description: meta.description, href: `${home}${x.page}/` };
    });
    const items = [...learnArts.map(a => ({ ...a, href: `${home}learn/${a.slug}/` })), ...extras];
    const seriesList = learnData.series.map(s => ({ s, list: items.filter(a => a.series === s.id).sort((a, b) => a.order - b.order) })).filter(x => x.list.length);
    const card = (a, track) => `<li><a class="cmp-card" href="${a.href}" data-track="${track}"><strong>${esc(a.title)}</strong><span>${esc(short(a.description, 110))}</span>${a.minutes ? `<span class="learn-min">${esc(learnFill(LT.minutes, { n: a.minutes }))}</span>` : ''}</a></li>`;
    page({
      path: `${L.path}learn/`,
      alt: Object.fromEntries(langs.filter(x => learnText[x.code] && learnNames(x.code).length).map(x => [x.code, `${x.path}learn/`])),
      title: LT.title,
      description: LT.description,
      jsonld: [
        crumbs([t('breadcrumb_top'), home], [LT.nav, learnUrl]),
        { '@context': 'https://schema.org', '@type': 'ItemList', name: LT.nav,
          itemListElement: items.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.title, url: abs(a.href) })) },
      ],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a></nav>
<h1>${esc(LT.nav)}</h1>
<p class="lead">${esc(LT.lead)}</p>
${seriesList.length > 1 ? `<nav class="topic-jump">${seriesList.map(({ s, list }) => `<a class="chip" href="#s-${s.id}">${esc(seriesName(s))} <small>${list.length}</small></a>`).join(' ')}</nav>` : ''}
${seriesList.map(({ s, list }) => `<section class="learn-series" id="s-${s.id}">
  <h2>${esc(seriesName(s))}</h2>
  ${s.desc?.[code] ? `<p class="muted">${esc(s.desc[code])}</p>` : ''}
  <ol class="cmp-list learn-list">${list.map(a => card(a, 'learn_index')).join('')}</ol>
</section>`).join('\n')}
<div data-ad="glossary"></div>`,
    });
    for (const a of learnArts) {
      const where = `learn/${code}/${a.slug}`;
      const body = fill(a.body
        .replace(/\{\{fig:([\w-]+)\}\}/g, (m, id) => {
          if (!figs[id]) throw new Error(`${where}: 存在しない図 ${id}`);
          const svg = localizeFigure(figs[id], figT[id], isDef);
          return svg ? figureHtml(svg, id) : '';
        })
        .replace(/\{\{term:([^}|]+)(?:\|([^}]+))?\}\}/g, (m, k, text) => {
          const g = glossary.find(x => x.term === k) ?? glossary.find(x => (x.aliases ?? []).includes(k));
          if (!g) throw new Error(`${where}: 用語集にない語 ${k}`);
          const lg = terms.find(x => x.key === g.term);
          const label = text ?? (isDef ? k : lg?.term ?? k);
          return lg ? `<a class="term-link" href="${home}term/${termSlug[g.term]}/">${esc(label)}</a>` : esc(label);
        }), common);
      if (/\{\{/.test(body)) throw new Error(`${where}: 置き換えられない {{…}} があります`);
      const s = seriesOf(a);
      const inSeries = items.filter(x => x.series === a.series).sort((x, y) => x.order - y.order);
      const next = inSeries.find(x => x.order > a.order);
      const main = catOf(a.cats[0]);
      const url = `${home}learn/${a.slug}/`;
      page({
        path: `${L.path}learn/${a.slug}/`,
        alt: learnAlt(a.slug),
        title: a.title,
        description: a.description,
        jsonld: [
          crumbs([t('breadcrumb_top'), home], [LT.nav, learnUrl], [a.title, url]),
          { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.description, inLanguage: L.htmlLang,
            datePublished: a.published ?? a.updated, dateModified: a.updated, mainEntityOfPage: abs(url),
            author: { '@type': 'Organization', name: siteName }, publisher: { '@type': 'Organization', name: siteName } },
        ],
        content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${learnUrl}">${esc(LT.nav)}</a> <span>›</span> <a href="${learnUrl}#s-${s.id}">${esc(seriesName(s))}</a></nav>
<article class="prose learn-article">
<h1>${esc(a.title)}</h1>
<p class="learn-meta">${esc(learnFill(LT.minutes, { n: a.minutes }))} · ${esc(learnFill(LT.updated, { d: fmtDay(a.updated) }))}</p>
${body}
</article>
${next ? `<section class="learn-next">
  <h2>${esc(LT.next)}</h2>
  <ul class="cmp-list">${card(next, 'learn_next')}</ul>
</section>` : ''}
${inSeries.length > 1 ? `<section>
  <h2>${esc(learnFill(LT.inSeries, { name: seriesName(s) }))}</h2>
  <ol class="learn-toc">${inSeries.map(x => `<li>${x.slug === a.slug ? `<strong aria-current="page">${esc(x.title)}</strong>` : `<a href="${x.href}" data-track="learn_series">${esc(x.title)}</a>`}</li>`).join('')}</ol>
</section>` : ''}
${main && qs[main.id]?.length ? `<p class="learn-quiz muted">${esc(LT.quizLine)} <a href="${home}c/${main.id}/" data-track="learn_topic">${esc(main.name)}</a></p>\n` : ''}${a.sources?.length ? `<details class="news-sources"><summary>${esc(LT.sources)}</summary><ul>${a.sources.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join('')}</ul></details>` : ''}
<div data-ad="term"></div>
<p><a class="btn btn-ghost" href="${learnUrl}">${esc(LT.all)}</a></p>`,
      });
    }
  }

  // 分野一覧 /c/: すべての分野を大分類ごとに開いて並べる(ヘッダーの Topics の行き先)
  page({
    path: `${L.path}c/`,
    alt: Object.fromEntries(langs.map(x => [x.code, `${x.path}c/`])),
    title: t('topics_all_title'),
    description: t('topics_all_desc', { n: live.length, q: live.reduce((s, c) => s + qs[c.id].length, 0) }),
    jsonld: crumbs([S.nav_home, home], [t('topics_all_title'), `${home}c/`]),
    scripts: ['progress.js'],
    content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a></nav>
<h1>${esc(t('topics_all_title'))}</h1>
<p class="lead">${esc(t('topics_all_lead', { n: live.length }))}</p>
<nav class="topic-jump" aria-label="${esc(t('topics_index'))}">${exams.flatMap(e => examGroups(e).map(({ g, list }) => `<a class="chip" href="#g-${e.id}-${g.id}">${esc(grName(e, g))} <small>${list.length}</small></a>`)).join(' ')}</nav>
<div class="topics topics-page">${topicBrowser(true)}
</div>`,
  });

  // 分野ページ /c/{id}/
  // 分野の訳がない言語(更新を止めた言語に新しく足した分野など)では、分野ページを作らず、hreflang からも外す
  const catAlt = id => Object.fromEntries(langs.filter(x => x.code === defLang || catByLang[x.code][id]).map(x => [x.code, `${x.path}c/${id}/`]));
  for (const c of cats) {
    if (!isDef && !catT[c.id]) continue;
    const g = groupOf(c);
    const count = qs[c.id].length;
    const pqs = qs[c.id].map(q => ({ ...q, cat: c.id }));
    const filter = levelFilter(pqs);
    page({
      path: `${L.path}c/${c.id}/`,
      alt: catAlt(c.id),
      title: t('category_title', { name: c.name }),
      description: c.description,
      noindex: !count,
      jsonld: crumbs([S.nav_home, home], [c.name, `${home}c/${c.id}/`]),
      scripts: filter ? ['progress.js', 'level.js'] : ['progress.js'],
      content: fill(catTpl, {
        ...common,
        id: c.id,
        name: esc(c.name),
        description: esc(c.description),
        groupName: esc(g.name),
        count,
        keyPoints: esc(t('key_points', { name: c.name })),
        otherInGroup: esc(t('other_in_group', { group: g.name })),
        // はじめて学ぶ人には、やさしい解説の記事を紹介文の前に案内する(この分野を主に扱う記事を先に)
        intro: (learnOfCat(c.id).length ? `<p class="learn-link">${esc(LT.catLink)}: ${learnOfCat(c.id).sort((a, b) => (b.cats[0] === c.id) - (a.cats[0] === c.id)).slice(0, 2).map(a => `<a href="${home}learn/${a.slug}/" data-track="cat_learn">${esc(a.title)}</a>`).join(' / ')}</p>\n` : '')
          + c.intro.split('\n').map(p => `<p>${esc(p)}</p>`).join('\n'),
        // 主ボタンは「10問練習」。全問・苦手問題はその横に並べる
        modes: count ? filter + modeCards(modes.filter(m => m.scope.includes('category')), c.id)
          .replace('<a class="mode-card primary"', '<a class="mode-card"')
          .replace('<div class="mode-grid">', `<div class="mode-grid">
  <a class="mode-card primary" href="${home}quiz/?mode=category&amp;c=${c.id}&amp;n=10" rel="nofollow">
    <strong>${esc(t('practice_10'))}</strong><span>${esc(t('practice_10_desc'))}</span>
  </a>`) + toolsIn(code).filter(x => x.cats.includes(c.id))
          .map(x => `\n<p><a class="btn btn-ghost" href="${home}tools/${x.slug}/">${esc(x.text[code].nav)} →</a></p>`).join('')
          + (beyondCats.includes(c.id) && beyondText[code] && pageNames(code).includes('beyond-scaling') ? `\n<p><a class="btn btn-ghost" href="${home}beyond-scaling/">${esc(beyondText[code].link)} →</a></p>` : '')
          : `<p class="muted">${esc(t('preparing'))}</p>`,
        siblings: catCards(live.filter(x => x.exam === c.exam && x.group === c.group && x.id !== c.id)),
        compareLinks: cmpSection(t('compare_in_cat'), cmp.filter(e => e.cat === c.id)),
        books: bookSection(c),
        // 問題一覧は折りたたむ(リンクは HTML に残るので、各問題ページへの内部リンクは保たれる)
        questionList: pqs.length ? `<details class="q-list-box">
  <summary><h2>${esc(t('question_list', { name: c.name, n: pqs.length }))}</h2></summary>
  ${qLinks(pqs)}
</details>` : '',
      }),
    });

    // 問題ページ /q/{分野ID}/{問題ID}/
    const solve = modes.find(m => m.id === 'category');
    // 検索結果の説明文: 問題文のあとに解説の最初の文を続ける(文の途中で切らない。日中韓は短めに)
    const cjk = ['ja', 'zh-hant', 'ko', 'zh'].includes(code);
    const descMax = cjk ? 110 : 155;
    const joint = text => (/[。！？]$/.test(text) || (code !== 'ko' && cjk && /[?]$/.test(text)) ? '' : ' '); // 文と文の間の空白(日本語・中国語の句点のあとは入れない)
    const qDescription = q => {
      let text = q.question.trim();
      for (const x of q.explanation.match(/(?:[^。.!?！？]|[.!?](?!\s|$))+(?:[。！？]|[.!?](?=\s|$)|$)\s*/g) ?? []) {
        if ((text + joint(text) + x).trim().length > descMax) break;
        text = (text + joint(text) + x).trim();
      }
      // 最初の文も収まらないときは、収まるところで切る
      if (text === q.question.trim()) text = short(`${text}${joint(text)}${q.explanation.trim()}`, descMax);
      return short(text, descMax + 5);
    };
    const termByKey = new Map(terms.map(y => [y.key, y]));
    // 問題ページから計算ツールへ: その問題を載せているツール、分野が主のツール、分野に関わるツールの順に2つまで
    const qToolLinks = (q, c) => {
      // 同じ順位なら、ツールの関連用語が問題文・解説に出てくるものを先に
      const text = `${q.question} ${q.explanation}`;
      const mentions = y => (y.terms ?? []).some(k => { const n = termByKey.get(k)?.term.replace(/\s*[(（].*$/, ''); return n && n.length > 1 && text.includes(n); });
      const rank = y => ((y.questions ?? []).includes(q.id) ? 0 : y.cat === c.id ? 2 : 4) - (mentions(y) ? 1 : 0);
      const ts = toolsIn(code).filter(y => (y.questions ?? []).includes(q.id) || (y.cats ?? []).includes(c.id)).sort((a, b) => rank(a) - rank(b)).slice(0, 2);
      return ts.length ? `<section>
  <h2>${esc(t('figure_tools'))}</h2>
  <div class="mode-grid compact">${ts.map(y => `<a class="mode-card" href="${home}tools/${y.slug}/"><strong>${esc(y.text[code].h1)}</strong><span>${esc(y.text[code].card)}</span></a>`).join('')}</div>
</section>` : '';
    };
    pqs.forEach((q, n) => {
      // 関連問題: 同じ分野で後ろに続く5問(末尾の次は先頭)
      const related = [...new Set([1, 2, 3, 4, 5].map(k => pqs[(n + k) % pqs.length]))].filter(r => r !== q);
      page({
        path: qUrl(c.id, q.id),
        alt: Object.fromEntries(langs.filter(x => hasQ[x.code].has(q.id)).map(x => [x.code, qUrl(c.id, q.id, x)])),
        fallback: x => (x.code === defLang || catByLang[x.code][c.id] ? `${x.path}c/${c.id}/` : x.path), // 分野の訳がない言語ではトップへ
        title: qTitle(c, q),
        description: qDescription(q),
        jsonld: crumbs([S.nav_home, home], [c.name, `${home}c/${c.id}/`], [short(q.question, 60), `${base}${qUrl(c.id, q.id)}`]),
        scripts: ['answer.js'],
        content: fill(qTpl, {
          ...common,
          catUrl: `${home}c/${c.id}/`,
          catName: esc(c.name),
          groupName: esc(g.name),
          question: esc(q.question),
          qData: qData({ ...q, cat: c.id }),
          continueUrl: `${home}quiz/?mode=category&amp;c=${c.id}&amp;n=9&amp;skip=${q.id}`,
          continueLabel: esc(t('q_continue', { name: c.name })),
          code: q.code && !q.codeFirst ? `<pre class="q-code" data-lang="${esc(q.codeLang ?? '')}"><code>${esc(q.code)}</code></pre>` : '',
          codeBefore: q.code && q.codeFirst ? `<pre class="q-code" data-lang="${esc(q.codeLang ?? '')}"><code>${esc(q.code)}</code></pre>` : '',
          choices: q.choices.map((ch, k) => `<li><span class="choice-mark">${mark(k)}</span><span class="choice-text">${esc(ch)}</span></li>`).join('\n'),
          answerIs: esc(t('answer_is', { mark: mark(q.answer), text: q.choices[q.answer] })),
          explanation: linked(q.explanation, c.id),
          figure: q.figureSvg && !q.figureFirst ? figureHtml(q.figureSvg, q.figureId) : '',
          figureBefore: q.figureSvg && q.figureFirst ? figureHtml(q.figureSvg, q.figureId) : '',
          choiceNotes: choiceNotes(q),
          report: reportLink(q.id),
          solveUrl: quizUrl(solve, c.id),
          solveLabel: esc(modeText(solve, 'label')),
          toCategory: esc(t('to_category')),
          nextQ: pqs.length > 1 ? `<nav class="q-nav"><a class="btn btn-ghost" href="${base}${qUrl(c.id, pqs[(n + pqs.length - 1) % pqs.length].id)}" rel="prev">${esc(t('q_prev'))}</a><a class="btn btn-primary" href="${base}${qUrl(c.id, pqs[(n + 1) % pqs.length].id)}" rel="next">${esc(t('q_next'))}</a></nav>` : '',
          compareLinks: cmpSection(t('compare_in_cat'), cmp.filter(e => e.cat === c.id).slice(0, 3)),
          toolLinks: qToolLinks(q, c),
          books: bookSection(c),
          related: related.length ? `<h2>${esc(t('related_questions', { name: c.name }))}</h2>\n${qLinks(related)}` : '',
        }),
      });
    });
  }

  // 学習コースのページ /course/{id}/
  const solveMode = modes.find(m => m.id === 'category');
  // コースの前に読む、やさしい解説の記事(data/courses.json の learn。この言語に記事があるものだけ)
  const courseLearn = co => {
    if (isDef) for (const slug of co.learn ?? []) if (!learnNames(defLang).includes(slug)) throw new Error(`course ${co.id}: 存在しない記事 ${slug}`);
    const list = (co.learn ?? []).map(slug => learnArts.find(a => a.slug === slug)).filter(Boolean);
    return list.length ? `<div class="learn-box"><p class="learn-box-h">${esc(LT.courseFirst)}</p><ul>${list.map(a => `<li><a href="${home}learn/${a.slug}/" data-track="course_learn">${esc(a.title)}</a> <span class="muted">(${esc(learnFill(LT.minutes, { n: a.minutes }))})</span></li>`).join('')}</ul></div>\n` : '';
  };
  for (const co of liveCourses) {
    const name = loc(co.name, code);
    page({
      path: `${L.path}course/${co.id}/`,
      alt: Object.fromEntries(langs.filter(x => typeof co.name !== 'object' || co.name[x.code]).map(x => [x.code, `${x.path}course/${co.id}/`])),
      title: t('course_title', { name }),
      description: loc(co.desc, code),
      scripts: ['course.js'],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}#courses">${esc(t('course_heading'))}</a></nav>
<h1>${esc(name)}</h1>
<p class="lead">${esc(loc(co.desc, code))}</p>
${courseLearn(co)}<div class="course-progress" data-course-progress="${esc(t('course_progress'))}">
  <p class="course-progress-text"></p>
  <span class="meter"><span class="meter-bar" style="width:0%"></span></span>
</div>
<div class="course-next" hidden data-solve="${home}quiz/?mode=${solveMode.id}&c=" data-all-done="${esc(t('course_all_done'))}">
  <p class="course-next-label">${esc(t('course_next'))}</p>
  <p class="course-next-name"></p>
  <p><a class="btn btn-primary" href="#">${esc(modeText(solveMode, 'label'))}</a></p>
</div>
<ol class="course-steps" data-done-label="${esc(t('course_step_done'))}">${co.steps.map(id => catOf(id)).map(c => `
  <li class="course-step" data-cat="${c.id}" data-count="${qs[c.id].length}">
    <a href="${home}c/${c.id}/"><span class="step-name">${esc(c.name)}</span><span class="step-status"></span></a>
    <span class="step-meta">${t('n_questions', { n: qs[c.id].length })} · ${esc(t('rate_label'))} <b data-rate="${c.id}">—</b> · ${esc(t('answered_label'))} <span data-answered="${c.id}">0</span></span>
  </li>`).join('')}
</ol>
<p class="muted">${esc(t('course_rule'))}</p>${co.id === 'interview' && interviewText[code] ? `
<p><a class="btn btn-ghost" href="${home}interview-questions/">${esc(interviewText[code].link)} →</a></p>` : ''}${co.id === 'transistor-to-software' && pageNames(code).includes('it-exam-guide') ? `
<p><a class="btn btn-ghost" href="${home}it-exam-guide/">基本情報・応用情報技術者試験のテクノロジ系をこのサイトで学ぶ →</a></p>` : ''}`,
    });
  }

  const miniQ = q => `
  <article class="q-mini"${qData(q)}>
    <h3><a href="${base}${qUrl(q.cat, q.id)}">${esc(q.question)}</a></h3>
    <ol class="q-choices">${q.choices.map((ch, k) => `<li><span class="choice-mark">${mark(k)}</span><span class="choice-text">${esc(ch)}</span></li>`).join('')}</ol>
    <details class="q-answer"><summary>${esc(t('answer_toggle'))}</summary><p class="verdict ok">${esc(t('answer_is', { mark: mark(q.answer), text: q.choices[q.answer] }))}</p><p class="explanation">${linked(q.explanation, q.cat)}</p></details>
  </article>`;

  // 数値のページ /en/numbers/(英語版のみ)。数値ごとに根拠の問題へリンクし、上部から10問のドリルへ
  if (numbers.length && code === numbersLang) {
    const qLink = id => qById.get(id) ? `<a href="${base}${qUrl(qById.get(id).cat, id)}">Practice</a>` : '';
    page({
      path: `${L.path}numbers/`,
      alt: { [code]: `${L.path}numbers/` },
      title: 'Numbers Every Chip Engineer Should Know',
      description: 'The orders of magnitude every semiconductor and computer engineer should know: band gaps, thermal voltage, DRAM refresh, EUV wavelength, cache latencies and more, each linked to a practice question.',
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a></nav>
<h1>Numbers Every Chip Engineer Should Know</h1>
<p class="lead">The orders of magnitude worth carrying in your head, from silicon's band gap to DRAM latency. Each value links to a practice question with a full explanation. Values are typical figures; the notes give the conditions.</p>
<p><a class="btn btn-primary" href="${home}quiz/?mode=numbers" rel="nofollow">Test yourself: 10 questions</a></p>
<nav class="glossary-nav" aria-label="Groups"><p>${numbers.map((g, i) => `<a class="chip" href="#n${i + 1}">${esc(g.group)}</a>`).join(' ')}</p></nav>
${numbers.map((g, i) => `<section id="n${i + 1}">
  <h2>${esc(g.group)}</h2>
  <div class="table-wrap"><table class="numbers">
    <thead><tr><th scope="col">Quantity</th><th scope="col">Value</th><th scope="col"><span class="visually-hidden">Practice</span></th></tr></thead>
    <tbody>${g.items.map(x => `
      <tr id="${esc(x.id)}"><th scope="row">${esc(x.label)}${x.note ? `<small>${esc(x.note)}</small>` : ''}</th><td class="num-value">${esc(x.value)}</td><td class="num-q">${(x.questions ?? []).slice(0, 1).map(qLink).join('')}</td></tr>`).join('')}
    </tbody>
  </table></div>
</section>`).join('\n')}
<p class="muted">Every value on this page also appears in at least one question on this site. Found an error? Let us know via the <a href="${home}contact/">contact page</a>.</p>
<div data-ad="numbers"></div>`,
    });
  }

  // 日英中の用語対訳表 /glossary/trilingual/(日本語・英語・繁体字だけ)。3言語の訳がそろった語を分野ごとに表にする。絞り込みは glossary.js
  if (dictLangs.includes(code)) {
    const D = dictText[code];
    const cols = Object.keys(D.cols); // 列の順(その言語 → 見出しの順)
    const nameIn = (g, x) => (x === defLang ? g.key : gloByLang[x][g.key].term);
    const has = g => dictLangs.every(x => x === defLang || gloByLang[x][g.key]);
    const groups = gloGroups.map(gr => ({ ...gr, cats: gr.cats.map(({ c, list }) => ({ c, list: list.filter(has) })).filter(x => x.list.length) })).filter(gr => gr.cats.length);
    const n = groups.reduce((s, gr) => s + gr.cats.reduce((k, x) => k + x.list.length, 0), 0);
    const cell = (g, x) => {
      const l = langs.find(y => y.code === x);
      const reading = x === defLang ? glossary.find(y => y.term === g.key).reading : '';
      return `<td lang="${l.htmlLang}"><a href="${base}${l.path}term/${termSlug[g.key]}/">${esc(nameIn(g, x))}</a>${reading ? `<small>${esc(reading)}</small>` : ''}</td>`;
    };
    page({
      path: `${L.path}glossary/trilingual/`,
      alt: Object.fromEntries(langs.filter(x => dictLangs.includes(x.code)).map(x => [x.code, `${x.path}glossary/trilingual/`])),
      title: D.title.replace('{n}', n),
      description: D.description.replace('{n}', n),
      scripts: ['glossary.js'],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}glossary/">${esc(S.nav_glossary)}</a></nav>
<h1>${esc(D.h1)}</h1>
<p class="lead">${esc(D.lead.replace('{n}', n))}</p>
<div class="search">
  <input id="glossary-q" type="search" placeholder="${esc(D.search)}" aria-label="${esc(D.search)}">
  <span id="glossary-count" class="muted" data-label="${esc(t('glossary_count'))}"></span>
</div>
<nav class="glossary-nav" aria-label="${esc(t('glossary_nav'))}">${groups.map(gr => `
  <p><b>${esc(gr.name)}</b>${gr.cats.map(({ c, list }) => ` <a class="chip" href="#cat-${c.id}">${esc(c.name)} <small>${list.length}</small></a>`).join('')}</p>`).join('')}
</nav>
${groups.map(gr => `<section class="glossary-group">
  <h2>${esc(gr.name)}</h2>${gr.cats.map(({ c, list }) => `
  <section class="glossary-cat" id="cat-${c.id}">
    <h3>${esc(c.name)}</h3>
    <div class="table-wrap"><table class="numbers dict">
      <thead><tr>${cols.map(x => `<th scope="col">${esc(D.cols[x])}</th>`).join('')}</tr></thead>
      <tbody>${list.map(g => `
        <tr class="term">${cols.map(x => cell(g, x)).join('')}</tr>`).join('')}
      </tbody>
    </table></div>
  </section>`).join('')}
</section>`).join('\n')}
<section>
  <h2>${esc(termQuizText[code].heading)}</h2>
  <p class="muted">${esc(termQuizText[code].lead)}</p>
  <p>${termQuizText[code].pairs.map(([f, to]) => `<a class="btn btn-ghost btn-small" href="${home}quiz/?mode=terms&amp;from=${f}&amp;to=${to}" rel="nofollow">${esc(termQuizText[code].arrow.replace('{from}', termQuizText[code].langs[f]).replace('{to}', termQuizText[code].langs[to]))}</a>`).join(' ')}</p>
</section>
<div data-ad="glossary"></div>
<p><a class="btn btn-ghost" href="${home}glossary/">${esc(t('term_to_glossary'))}</a></p>`,
    });
  }

  // 技術面接の質問一覧 /interview-questions/: トピックごとに、分野の先頭(基本)の問題から interviewPer 問ずつ
  if (interviewText[code]) {
    const D = interviewText[code];
    const topics = interviewTopics.map(tp => {
      const pools = tp.cats.filter(id => qs[id]?.length).map(id => qs[id].filter(q => !q.figureSvg && !q.code).map(q => ({ ...q, cat: id })));
      const list = [];
      for (let i = 0; list.length < interviewPer && pools.some(p => p[i]); i++) for (const p of pools) if (p[i] && list.length < interviewPer) list.push(p[i]);
      return { ...tp, list };
    }).filter(tp => tp.list.length);
    const n = topics.reduce((s, tp) => s + tp.list.length, 0);
    page({
      path: `${L.path}interview-questions/`,
      alt: Object.fromEntries(langs.filter(x => interviewText[x.code]).map(x => [x.code, `${x.path}interview-questions/`])),
      title: D.title.replace('{n}', n),
      description: D.description.replace('{n}', n),
      jsonld: [crumbs([t('breadcrumb_top'), home], [D.h1, `${home}interview-questions/`])],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a></nav>
<h1>${esc(D.h1)}</h1>
<p class="lead">${esc(D.lead.replace('{k}', interviewPer))}</p>
<nav class="glossary-nav" aria-label="${esc(t('glossary_nav'))}"><p>${topics.map(tp => `<a class="chip" href="#${tp.id}">${esc(tp.name[code])}</a>`).join(' ')}</p></nav>
${topics.map(tp => `<section id="${tp.id}">
  <h2>${esc(tp.name[code])}</h2>
  <ol class="iq-list">${tp.list.map(q => `
    <li><a href="${base}${qUrl(q.cat, q.id)}">${esc(q.question)}</a>
      <details><summary>${esc(D.answer)}</summary><p><b>${esc(q.choices[q.answer])}</b></p><p class="muted">${esc(q.explanation)}</p></details></li>`).join('')}
  </ol>
  <p><a class="btn btn-ghost btn-small" href="${home}quiz/?mode=set&amp;ids=${tp.list.map(q => q.id).join(',')}&amp;t=${encodeURIComponent(tp.name[code])}" rel="nofollow">${esc(D.solve)} →</a></p>
</section>`).join('\n')}
${liveCourses.some(co => co.id === 'interview') ? `<p><a class="btn btn-primary" href="${home}course/interview/">${esc(D.course)}</a></p>` : ''}
<div data-ad="compare"></div>`,
    });
  }

  // 職種ガイド: 一覧 /careers/ と職種ごとのページ /careers/{id}/
  const carT = tr('careers');
  const carList = careers.filter(x => careerText[code] && (isDef || carT[x.id])).map(x => ({ ...x, ...(isDef ? {} : carT[x.id]) }));
  if (carList.length) {
    const C = careerText[code];
    const carPath = (l, id = '') => `${l.path}careers/${id ? `${id}/` : ''}`;
    page({
      path: carPath(L),
      alt: Object.fromEntries(langs.filter(x => careerText[x.code] && (x.code === defLang || Object.keys(carByLang[x.code]).length)).map(x => [x.code, carPath(x)])),
      title: C.indexTitle,
      description: C.indexDesc.replace('{n}', carList.length),
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a></nav>
<h1>${esc(C.index)}</h1>
<p class="lead">${esc(C.indexLead)}</p>
<ul class="cmp-list">${carList.map(x => `
  <li><a class="cmp-card" href="${home}careers/${x.id}/"><strong>${esc(x.name)}</strong><span>${esc(x.short)}</span></a></li>`).join('')}
</ul>
<div data-ad="compare"></div>`,
    });
    for (const x of carList) {
      const fields = x.fields.map(catOf).filter(c => c && qs[c.id]?.length);
      // 基礎10問: 分野を順にめぐって、易しい問題から選ぶ(並びは問題IDで固定)
      const pools = fields.map(c => [...qs[c.id]].sort((a, b) => (a.level ?? 2) - (b.level ?? 2) || (a.id < b.id ? -1 : 1)));
      const picked = [];
      for (let i = 0; picked.length < 10 && pools.some(p => p.length > i); i++) for (const p of pools) if (p[i] && picked.length < 10) picked.push(p[i].id);
      const relTerms = (x.terms ?? []).map(k => terms.find(g => g.key === k)).filter(Boolean);
      const relCourses = (x.courses ?? []).map(id => liveCourses.find(co => co.id === id)).filter(Boolean);
      const url = `${home}careers/${x.id}/`;
      page({
        path: carPath(L, x.id),
        alt: Object.fromEntries(carLangs(x.id).map(l => [l.code, carPath(l, x.id)])),
        title: C.title.replace('{name}', x.name),
        description: x.description,
        jsonld: [
          crumbs([t('breadcrumb_top'), home], [C.index, `${home}careers/`], [x.name, url]),
          ...(x.faq?.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: x.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
        ],
        content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}careers/">${esc(C.index)}</a></nav>
<article class="term-page">
  <h1>${esc(x.name)}</h1>
  <p class="lead">${esc(x.short)}</p>
</article>
${x.sections.map(sec => `<section class="term-about">
  <h2>${esc(sec.h)}</h2>
  <p>${linked(sec.p)}</p>
</section>`).join('\n')}
<section>
  <h2>${esc(C.fields)}</h2>
  <p>${fields.map(c => `<a class="chip" href="${home}c/${c.id}/">${esc(c.name)} <small>${esc(C.qn.replace('{n}', qs[c.id].length))}</small></a>`).join(' ')}</p>
</section>
${picked.length ? `<section>
  <h2>${esc(C.quiz)}</h2>
  <p class="muted">${esc(C.quizDesc)}</p>
  <p><a class="btn btn-primary" href="${home}quiz/?mode=set&amp;ids=${picked.join(',')}&amp;t=${encodeURIComponent(x.name)}" rel="nofollow">${esc(C.quiz)} →</a></p>
</section>` : ''}
${relCourses.length ? `<section>
  <h2>${esc(C.courses)}</h2>
  <div class="mode-grid compact">${relCourses.map(co => `<a class="mode-card" href="${home}course/${co.id}/"><strong>${esc(loc(co.name, code))}</strong><span>${esc(loc(co.desc, code))}</span></a>`).join('')}</div>
</section>` : ''}
${relTerms.length ? `<section>
  <h2>${esc(C.terms)}</h2>
  <p>${relTerms.map(g => `<a class="chip" href="${home}term/${termSlug[g.key]}/">${esc(g.term)}</a>`).join(' ')}</p>
</section>` : ''}
${x.faq?.length ? `<section class="faq">
  <h2>${esc(t('compare_faq'))}</h2>${x.faq.map(f => `
  <h3>${esc(f.q)}</h3>
  <p>${esc(f.a)}</p>`).join('')}
</section>` : ''}
<div data-ad="compare"></div>
<p><a class="btn btn-ghost" href="${home}careers/">${esc(C.all)}</a></p>`,
      });
    }
  }

  // 計算ツール。計算はブラウザ側の {id}.js で行い、HTMLには入力欄・結果の枠・解説を置く。
  // ツールごとに違う部分(入力欄と結果の枠)は toolBody[id] が作り、解説・練習問題・よくある質問・関連用語は共通
  const field = (name, label, value, attrs = '') => `<label class="dy-field"><span>${esc(label)}</span><input name="${name}" type="number" inputmode="decimal" value="${value}" ${attrs}></label>`;
  const select = (name, label, options, value) => `<label class="dy-field"><span>${esc(label)}</span><select name="${name}">${options.map(([v, text]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const stat = (key, label) => `<div><dt>${esc(label)}</dt><dd data-out="${key}">–</dd></div>`;
  // 入力欄と結果の枠を data/tools/{ID}.json の form から作る(toolBody に専用の形がないツール)。
  // form: { id, fields: [{ name, value, attrs?, options?: [値…] }], outputs: [{ heading?, stats: [名前…] }], note? }
  // 文言は text の name(入力)・stat 名の - を _ にしたもの(結果)・{name}_{値}(選択肢)・heading と note のキー。
  // JS で使う文言は text.js に書くと、form の data-text に入る
  const formBody = (f, x) => `<form id="${f.id}" class="dy-form"${x.js ? ` data-text="${esc(JSON.stringify(x.js))}"` : ''}>
    <h2>${esc(x.in_heading)}</h2>
    ${f.fields.map(y => (y.options ? select(y.name, x[y.name], y.options.map(v => [v, x[`${y.name}_${v}`] ?? v]), y.value) : field(y.name, x[y.name], y.value, y.attrs ?? ''))).join('\n    ')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>${f.outputs.map(o => `${o.heading ? `\n    <h3>${esc(x[o.heading])}</h3>` : ''}
    <dl class="dy-stats">${o.stats.map(k => stat(k, x[k.replaceAll('-', '_')])).join('')}</dl>`).join('')}${f.svg ? `
    <svg id="${f.svg}" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label ?? x.h1)}"></svg>` : ''}${f.note ? `
    <p class="muted">${esc(x[f.note])}</p>` : ''}
  </section>`;
  const toolBody = {
    'die-yield': x => `<form id="dy-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('d', x.wafer, [150, 200, 300, 450].map(v => [v, `${v} mm`]), 300)}
    ${field('w', x.die_w, 10, 'min="0.1" step="0.1"')}
    ${field('h', x.die_h, 10, 'min="0.1" step="0.1"')}
    ${field('scribe', x.scribe, 100, 'min="0" step="10"')}
    ${field('edge', x.edge, 3, 'min="0" step="0.5"')}
    ${field('d0', x.d0, 0.1, 'min="0" step="0.01"')}
    ${field('alpha', x.alpha, 3, 'min="0.1" step="0.5"')}
    ${field('cost', x.cost, 10000, 'min="0" step="100"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('area', x.area)}${stat('gross', x.gross)}${stat('formula', x.gross_formula)}</dl>
    <div class="table-wrap"><table class="dy-table">
      <thead><tr><th scope="col">${esc(x.model)}</th><th scope="col">${esc(x.yield)}</th><th scope="col">${esc(x.good)}</th><th scope="col">${esc(x.cpgd)}</th></tr></thead>
      <tbody>${['poisson', 'murphy', 'negbin'].map(m => `<tr><th scope="row">${esc(x[m])}</th><td data-out="${m}-y">–</td><td data-out="${m}-good">–</td><td data-out="${m}-cost">–</td></tr>`).join('')}</tbody>
    </table></div>
  </section>
  <section class="dy-map">
    <h2>${esc(x.map_heading)}</h2>
    <canvas id="dy-map" width="320" height="320" role="img" aria-label="${esc(x.map_heading)}"></canvas>
    <p class="dy-legend"><span class="dy-key ok"></span>${esc(x.legend_good)} <span class="dy-key ng"></span>${esc(x.legend_bad)} · ${esc(x.legend_sim)}: <b data-out="sim">–</b></p>
    <p><button type="button" class="btn btn-ghost btn-small" id="dy-rerun">${esc(x.rerun)}</button></p>
    <p class="muted">${esc(x.map_note)}</p>
  </section>`,
    litho: x => `<form id="litho-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('lambda', x.lambda, [[436, 'g-line 436 nm'], [365, 'i-line 365 nm'], [248, 'KrF 248 nm'], [193, 'ArF 193 nm'], [13.5, 'EUV 13.5 nm']], 193)}
    ${field('na', x.na, 1.35, 'min="0.05" max="1.8" step="0.01"')}
    ${field('k1', x.k1, 0.28, 'min="0.1" max="1" step="0.01"')}
    ${field('k2', x.k2, 0.5, 'min="0.1" max="2" step="0.05"')}
    ${field('pitch', x.pitch, 64, 'min="1" step="1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('hp', x.res)}${stat('minpitch', x.minpitch)}${stat('dof', x.dof)}${stat('passes', x.passes)}</dl>
    <p class="muted">${esc(x.passes_note)}</p>
  </section>
  <section class="dy-out">
    <h2>${esc(x.table_heading)}</h2>
    <div class="table-wrap"><table class="dy-table" id="litho-table">
      <thead><tr><th scope="col">${esc(x.col_tool)}</th><th scope="col">λ</th><th scope="col">NA</th><th scope="col">${esc(x.col_res)}</th><th scope="col">${esc(x.col_dof)}</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <p class="muted">${esc(x.table_note)}</p>
  </section>`,
    sta: x => `<form id="sta-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('period', x.period, 2, 'min="0.01" step="0.05"')}
    ${field('tcqmax', x.tcqmax, 0.15, 'min="0" step="0.01"')}
    ${field('tcqmin', x.tcqmin, 0.08, 'min="0" step="0.01"')}
    ${field('combmax', x.combmax, 1.5, 'min="0" step="0.05"')}
    ${field('combmin', x.combmin, 0.05, 'min="0" step="0.01"')}
    ${field('setup', x.setup, 0.06, 'min="0" step="0.01"')}
    ${field('hold', x.hold, 0.04, 'min="0" step="0.01"')}
    ${field('skew', x.skew, 0, 'step="0.01"')}
    ${field('unc', x.unc, 0.05, 'min="0" step="0.01"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('setup-slack', x.setup_slack)}${stat('hold-slack', x.hold_slack)}${stat('fmax', x.fmax)}</dl>
    <svg id="sta-chart" class="sta-chart" viewBox="0 0 600 170" role="img" aria-label="${esc(x.chart_label)}"
      data-labels="${esc(JSON.stringify({ launch: x.lbl_launch, capture: x.lbl_capture, max: x.lbl_arrival_max, min: x.lbl_arrival_min, req: x.lbl_required, hold: x.lbl_hold }))}"></svg>
    <p class="dy-legend"><span class="dy-key ok"></span>${esc(x.legend_ok)} <span class="dy-key ng"></span>${esc(x.legend_ng)}</p>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    'mosfet-iv': x => `<form id="iv-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('vth', x.vth, 0.5, 'min="0" step="0.05"')}
    ${field('kp', x.kp, 200, 'min="1" step="10"')}
    ${field('wl', x.wl, 10, 'min="0.1" step="0.5"')}
    ${field('lambda', x.lambda, 0.05, 'min="0" step="0.01"')}
    ${field('vgs', x.vgs, 1.5, 'min="0" step="0.05"')}
    ${field('vds', x.vds, 1.2, 'min="0" step="0.05"')}
    ${field('vdd', x.vdd, 3.3, 'min="0.1" step="0.1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('region', x.region)}${stat('id', x.id)}${stat('vdsat', x.vdsat)}${stat('gm', x.gm)}${stat('ro', x.ro)}</dl>
    <svg id="iv-chart" class="sta-chart" viewBox="0 0 600 340" role="img" aria-label="${esc(x.chart_label)}"
      data-labels="${esc(JSON.stringify({ cutoff: x.r_cutoff, linear: x.r_linear, sat: x.r_sat, op: x.lbl_op }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    thermal: x => `<form id="th-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('p', x.p, 1, 'min="0" step="0.1"')}
    ${field('ta', x.ta, 25, 'step="1"')}
    ${field('tjmax', x.tjmax, 125, 'step="5"')}
    ${field('tja', x.tja, 50, 'min="0" step="1"')}
    ${field('tjc', x.tjc, 1, 'min="0" step="0.1"')}
    ${field('tcs', x.tcs, 0.5, 'min="0" step="0.1"')}
    ${field('tsa', x.tsa, 3, 'min="0" step="0.5"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <div class="table-wrap"><table class="dy-table">
      <thead><tr><th scope="col"></th><th scope="col">${esc(x.col_tj)}</th><th scope="col">${esc(x.col_margin)}</th><th scope="col">${esc(x.col_pmax)}</th></tr></thead>
      <tbody>
        <tr><th scope="row">${esc(x.row_ja)}</th><td data-out="ja-tj">–</td><td data-out="ja-margin">–</td><td data-out="ja-pmax">–</td></tr>
        <tr><th scope="row">${esc(x.row_hs)} (<span data-out="hs-theta">–</span>)</th><td data-out="hs-tj">–</td><td data-out="hs-margin">–</td><td data-out="hs-pmax">–</td></tr>
      </tbody>
    </table></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'mem-bw': x => `<form id="bw-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('preset', x.preset, [['', x.custom], [0, 'DDR4-3200'], [1, 'DDR5-6400'], [2, 'LPDDR5X-8533'], [3, 'GDDR6 16 Gb/s'], [4, 'HBM3 6.4 Gb/s']], 0)}
    ${field('rate', x.rate, 3200, 'min="1" step="100"')}
    ${field('width', x.width, 64, 'min="1" step="8"')}
    ${field('count', x.count, 1, 'min="1" step="1"')}
    ${field('eff', x.eff, 70, 'min="1" max="100" step="5"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('peak', x.peak)}${stat('eff', x.effective)}${stat('pin', x.pin)}${stat('per-ns', x.per_ns)}</dl>
  </section>
  <section class="dy-out">
    <h2>${esc(x.table_heading)}</h2>
    <div class="table-wrap"><table class="dy-table" id="bw-table">
      <thead><tr><th scope="col">${esc(x.col_std)}</th><th scope="col">MT/s</th><th scope="col">${esc(x.col_width)}</th><th scope="col">${esc(x.col_peak)}</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <p class="muted">${esc(x.table_note)}</p>
  </section>`,
    'adc-snr': x => `<form id="adc-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('bits', x.bits, 12, 'min="1" max="32" step="1"')}
    ${field('fs', x.fs, 2, 'min="0.001" step="0.1"')}
    ${field('fin', x.fin, 10, 'min="0" step="1"')}
    ${field('jitter', x.jitter, 1, 'min="0" step="0.1"')}
    ${field('osr', x.osr, 1, 'min="1" step="1"')}
    ${field('sinad', x.sinad, 70, 'step="0.5"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('lsb', x.lsb)}${stat('snr-q', x.snr_q)}${stat('snr-j', x.snr_j)}${stat('snr', x.snr)}${stat('enob', x.enob)}${stat('enob-in', x.enob_in)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    amdahl: x => `<form id="am-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('p', x.p, 95, 'min="0" max="100" step="1"')}
    ${field('n', x.n, 16, 'min="1" step="1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('amdahl', x.amdahl)}${stat('eff', x.eff)}${stat('limit', x.limit)}${stat('gustafson', x.gustafson)}</dl>
    <svg id="am-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    'cache-calc': x => `<form id="cc-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('abits', x.abits, 32, 'min="8" max="64" step="1"')}
    ${field('size', x.size, 32, 'min="1" step="1"')}
    ${field('line', x.line, 64, 'min="1" step="1"')}
    ${field('ways', x.ways, 8, 'min="1" step="1"')}
    ${field('hit', x.hit, 4, 'min="0" step="1"')}
    ${field('miss', x.miss, 5, 'min="0" max="100" step="0.5"')}
    ${field('penalty', x.penalty, 100, 'min="0" step="10"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p class="muted">${esc(x.bar_heading)}</p>
    <div id="cc-bar" class="cc-bar" data-tag="${esc(x.tag)}" data-index="${esc(x.index)}" data-offset="${esc(x.offset)}" data-cycles="${esc(x.cycles)}"></div>
    <p id="cc-warn" class="muted" hidden>${esc(x.warn)}</p>
    <dl class="dy-stats">${stat('lines', x.lines)}${stat('sets', x.sets)}${stat('tag', x.tag)}${stat('index', x.index)}${stat('offset', x.offset)}${stat('amat', x.amat)}</dl>
  </section>`,
    'cmos-power': x => `<form id="cp-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('alpha', x.alpha, 0.1, 'min="0" max="1" step="0.01"')}
    ${field('c', x.c, 1, 'min="0" step="0.1"')}
    ${field('v', x.v, 1.0, 'min="0" step="0.05"')}
    ${field('f', x.f, 2, 'min="0" step="0.1"')}
    ${field('ileak', x.ileak, 100, 'min="0" step="10"')}
    ${field('scale', x.scale, 80, 'min="10" max="100" step="5"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('dyn', x.dyn)}${stat('stat', x.stat)}${stat('total', x.total)}${stat('share', x.share)}${stat('dvfs', x.dvfs)}${stat('dvfs-ratio', x.dvfs_ratio)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'pn-junction': x => `<form id="pn-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('mat', x.mat, [['si', x.mat_si], ['ge', x.mat_ge], ['gaas', x.mat_gaas]], 'si')}
    ${field('na', x.na, '1e17', 'step="any"')}
    ${field('nd', x.nd, '1e16', 'step="any"')}
    ${field('vr', x.vr, 0, 'step="0.1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p id="pn-warn" class="muted" hidden>${esc(x.warn)}</p>
    <dl class="dy-stats">${stat('vbi', x.vbi)}${stat('w', x.w)}${stat('xn', x.xn)}${stat('xp', x.xp)}${stat('emax', x.emax)}${stat('cj', x.cj)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    oxidation: x => `<form id="ox-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('kind', x.kind, [['dry', x.dry], ['wet', x.wet]], 'dry')}
    ${select('orient', x.orient, [['100', '(100)'], ['111', '(111)']], '100')}
    ${field('temp', x.temp, 1000, 'min="700" max="1300" step="10"')}
    ${field('time', x.time, 1, 'min="0" step="0.1"')}
    ${field('xi', x.xi, 0, 'min="0" step="1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('x', x.x)}${stat('grown', x.grown)}${stat('si', x.si)}${stat('b', x.b)}${stat('ba', x.ba)}</dl>
    <svg id="ox-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'interconnect-rc': x => `<form id="rc-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('metal', x.metal, [['cu', 'Cu', 1.7], ['al', 'Al', 2.7], ['w', 'W', 5.3], ['co', 'Co', 6.2], ['ru', 'Ru', 7.1]].map(([v, name, rho]) => [v, `${name} ${rho} µΩ·cm`]), 'cu')}
    ${field('rhox', x.rhox, 1, 'min="1" step="0.1"')}
    ${field('w', x.w, 50, 'min="1" step="5"')}
    ${field('t', x.t, 100, 'min="1" step="5"')}
    ${field('s', x.s, 50, 'min="1" step="5"')}
    ${field('h', x.h, 100, 'min="1" step="5"')}
    ${field('k', x.k, 2.7, 'min="1" step="0.1"')}
    ${field('len', x.len, 1000, 'min="1" step="100"')}
    ${field('rdrv', x.rdrv, 1000, 'min="0" step="100"')}
    ${field('cl', x.cl, 10, 'min="0" step="1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('r-len', x.r_len)}${stat('r', x.r)}${stat('c-len', x.c_len)}${stat('c', x.c)}${stat('cc-share', x.cc_share)}${stat('wire', x.wire)}${stat('total', x.total)}</dl>
    <svg id="rc-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    jitter: x => `<form id="jt-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('f0', x.f0, 100, 'min="0.001" step="any"')}
    ${field('lo', x.lo, 12, 'min="0.001" step="any"')}
    ${field('hi', x.hi, 20, 'min="0.001" step="any"')}
    ${[['1 kHz', -110], ['10 kHz', -120], ['100 kHz', -130], ['1 MHz', -145], ['10 MHz', -155], ['20 MHz', -155]].map(([f, v], i) => field(`p${i}`, x.pn_at.replace('{f}', f), v, 'max="0" step="1"')).join('\n    ')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p id="jt-warn" class="muted" hidden>${esc(x.warn)}</p>
    <dl class="dy-stats">${stat('integ', x.integ)}${stat('mrad', x.mrad)}${stat('deg', x.deg)}${stat('jitter', x.jitter)}</dl>
    <svg id="jt-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
    <div class="table-wrap"><table class="dy-table">
      <thead><tr><th scope="col">${esc(x.col_seg)}</th><th scope="col">${esc(x.col_share)}</th></tr></thead>
      <tbody>${['1 kHz – 10 kHz', '10 kHz – 100 kHz', '100 kHz – 1 MHz', '1 MHz – 10 MHz', '10 MHz – 20 MHz', x.row_out].map((r, i) => `<tr><th scope="row">${esc(r)}</th><td data-out="seg${i}">–</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    pdn: x => `<form id="pdn-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('v', x.v, 1.0, 'min="0.01" step="0.05"')}
    ${field('ripple', x.ripple, 5, 'min="0.1" step="0.5"')}
    ${field('di', x.di, 10, 'min="0.001" step="1"')}
    ${field('c', x.c, 1, 'min="0.0001" step="any"')}
    ${field('esr', x.esr, 10, 'min="0.01" step="1"')}
    ${field('esl', x.esl, 0.5, 'min="0.001" step="0.05"')}
    ${field('n', x.n, 10, 'min="1" step="1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('zt', x.zt)}${stat('srf', x.srf)}${stat('zsrf', x.zsrf)}${stat('flo', x.flo)}${stat('fhi', x.fhi)}${stat('nmin', x.nmin)}</dl>
    <p id="pdn-warn" class="muted" hidden>${esc(x.warn)}</p>
    <svg id="pdn-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    resistivity: x => `<form id="rs-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('type', x.type, [['n', x.type_n], ['p', x.type_p]], 'p')}
    ${field('n', x.n, '1e15', 'min="0" step="any"')}
    ${field('rho', x.rho, 13.5, 'min="0" step="any"')}
    <p class="muted qs-wide">${esc(x.both)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p id="rs-warn" class="muted" hidden>${esc(x.warn)}</p>
    <dl class="dy-stats">${stat('n', x.o_n)}${stat('rho', x.o_rho)}${stat('mu', x.o_mu)}${stat('sigma', x.o_sigma)}</dl>
    <svg id="rs-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'bandgap-wavelength': x => `<form id="bg-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('preset', x.preset, [['', x.custom], ...[['Si', 1.12, 0], ['Ge', 0.66, 0], ['GaAs', 1.42, 1], ['InP', 1.34, 1], ['In₀.₅₃Ga₀.₄₇As', 0.75, 1], ['GaP', 2.26, 0], ['4H-SiC', 3.26, 0], ['GaN', 3.4, 1], ['ZnO', 3.37, 1], [x.diamond, 5.47, 0], ['AlN', 6.2, 1]]
      .map(([name, eg, direct]) => [String(eg), `${name} (${eg} eV, ${direct ? x.direct : x.indirect})`])], '1.42')}
    ${field('eg', x.eg, 1.42, 'min="0" step="any"')}
    ${field('lambda', x.lambda, 873.1, 'min="0" step="any"')}
    <p class="muted qs-wide">${esc(x.both)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('lambda', x.o_lambda)}${stat('eg', x.o_eg)}${stat('um', x.o_um)}${stat('freq', x.o_freq)}${stat('wn', x.o_wn)}${stat('region', x.o_region)}</dl>
    <p class="bg-color"><span id="bg-swatch" class="bg-swatch" hidden></span></p>
    <svg id="bg-band" class="sta-chart" viewBox="0 0 600 92" role="img" aria-label="${esc(x.band_label)}"
      data-labels="${esc(JSON.stringify({ uv: x.r_uv, violet: x.r_violet, blue: x.r_blue, green: x.r_green, yellow: x.r_yellow, orange: x.r_orange, red: x.r_red, nir: x.r_nir, ir: x.r_ir, ir_band: x.r_ir_band }))}"></svg>
    <p class="muted">${esc(x.band_note)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'intrinsic-carrier': x => `<form id="ni-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('mat', x.mat, [['si', x.mat_si], ['ge', x.mat_ge], ['gaas', x.mat_gaas]], 'si')}
    ${field('t', x.t, 300, 'min="50" max="1500" step="10"')}
    ${field('dop', x.dop, '1e15', 'min="0" step="any"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p id="ni-warn" class="muted" hidden>${esc(x.warn)}</p>
    <dl class="dy-stats">${stat('ni', x.o_ni)}${stat('eg', x.o_eg)}${stat('kt', x.o_kt)}${stat('ratio', x.o_ratio)}${stat('maj', x.o_maj)}${stat('min', x.o_min)}${stat('ti', x.o_ti)}</dl>
    <svg id="ni-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'mosfet-vth': x => `<form id="vt-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${select('type', x.type, [['nmos', x.type_n], ['pmos', x.type_p]], 'nmos')}
    ${select('gate', x.gate, [['npoly', x.gate_npoly], ['ppoly', x.gate_ppoly], ['metal', x.gate_metal]], 'npoly')}
    ${field('phim', x.phim, 4.6, 'min="3" max="6" step="0.05"')}
    ${field('tox', x.tox, 5, 'min="0.5" step="0.5"')}
    ${field('n', x.n, '5e17', 'min="0" step="any"')}
    ${field('nf', x.nf, '1e10', 'min="0" step="any"')}
    ${field('vsb', x.vsb, 0, 'min="0" step="0.1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('vth', x.o_vth)}${stat('vfb', x.o_vfb)}${stat('phims', x.o_phims)}${stat('phif', x.o_phif)}${stat('qd', x.o_qd)}${stat('cox', x.o_cox)}${stat('wd', x.o_wd)}${stat('gamma', x.o_gamma)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'base-convert': x => `<form id="bc-form" class="dy-form" data-text="${esc(JSON.stringify({ invalid: x.invalid, overflow: x.overflow }))}">
    <h2>${esc(x.in_heading)}</h2>
    <label class="dy-field"><span>${esc(x.value)}</span><input name="value" type="text" inputmode="text" autocomplete="off" spellcheck="false" value="-5"></label>
    ${select('base', x.base, ['2', '8', '10', '16'].map(b => [b, x.bases[b]]), '10')}
    ${select('bits', x.bits, ['8', '16', '32', '64'].map(b => [b, `${b} bit`]), '8')}
    <p class="notice" id="bc-error" hidden></p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats bc-stats">${stat('bin', x.bin)}${stat('hex', x.hex)}${stat('oct', x.oct)}${stat('dec_u', x.dec_u)}${stat('dec_s', x.dec_s)}</dl>
    <h3>${esc(x.neg_heading)}</h3>
    <dl class="dy-stats bc-stats">${stat('inv', x.inv)}${stat('neg', x.neg)}</dl>
    <h3>${esc(x.range_heading)}</h3>
    <dl class="dy-stats">${stat('range_u', x.range_u)}${stat('range_s', x.range_s)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    ieee754: x => `<form id="fp-form" class="dy-form" data-text="${esc(JSON.stringify({ sign: x.sign, exp: x.exp, man: x.man, kinds: x.kinds, exact: x.exact_ok, digits: x.digits }))}">
    <h2>${esc(x.in_heading)}</h2>
    <label class="dy-field"><span>${esc(x.value)}</span><input name="value" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="0.1"></label>
    ${select('fmt', x.fmt, ['half', 'single', 'double'].map(f => [f, x.fmts[f]]), 'single')}
    <label class="dy-field"><span>${esc(x.hexin)}</span><input name="hex" type="text" autocomplete="off" spellcheck="false" value=""></label>
    <p class="notice" id="fp-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p class="fp-bits" data-out="bits" aria-label="${esc(x.bits)}"></p>
    <p class="fp-legend"><span class="fp-s">${esc(x.sign)}</span> <span class="fp-e">${esc(x.exp)}</span> <span class="fp-m">${esc(x.man)}</span></p>
    <dl class="dy-stats bc-stats">${stat('hex', x.hex)}${stat('kind', x.kind)}${stat('sign', x.sign)}${stat('exp', x.exp)}${stat('man', x.man)}${stat('exact', x.exact)}${stat('err', x.err)}</dl>
    <h3>${esc(x.props_heading)}</h3>
    <dl class="dy-stats">${stat('prec', x.prec)}${stat('eps', x.eps)}${stat('max', x.max)}${stat('minn', x.minn)}${stat('mins', x.mins)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    kmap: x => `<form id="km-form" class="dy-out km" data-text="${esc(JSON.stringify({ essential: x.essential }))}">
    <div class="km-controls">
      ${select('n', x.vars, [['2', '2 (A, B)'], ['3', '3 (A, B, C)'], ['4', '4 (A, B, C, D)']], '4')}
      <label class="dy-field"><span>${esc(x.examples)}</span><select id="km-example"><option value="">–</option>${Object.entries(x.ex).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="dy-field"><span>${esc(x.minterms)}</span><input name="m" type="text" inputmode="numeric" autocomplete="off"></label>
      <label class="dy-field"><span>${esc(x.dontcares)}</span><input name="d" type="text" inputmode="numeric" autocomplete="off"></label>
      <div class="km-btns"><button type="button" class="btn btn-ghost btn-small" id="km-apply">${esc(x.apply)}</button> <button type="button" class="btn btn-ghost btn-small" id="km-clear">${esc(x.clear)}</button></div>
    </div>
    <p class="muted">${esc(x.cell_hint)}</p>
    <div class="km-views">
      <div class="km-a-map"><h2>${esc(x.view_map)}</h2><div id="km-map" class="km-scroll"></div></div>
      <div class="km-a-tt"><h2>${esc(x.view_table)}</h2><div id="km-tt" class="km-scroll km-ttwrap"></div></div>
    <section class="km-a-res" aria-live="polite">
      <h2>${esc(x.out_heading)}</h2>
      <h3>${esc(x.sop)}</h3>
      <p class="km-expr" id="km-sop"></p>
      <p class="muted" id="km-alt" hidden>${esc(x.alt)}</p>
      <h3>${esc(x.pos)}</h3>
      <p class="km-expr" id="km-pos"></p>
      <p class="muted" id="km-alt-pos" hidden>${esc(x.alt)}</p>
      <h3>${esc(x.primes)}</h3>
      <ul class="km-primes" id="km-primes"></ul>
      <dl class="dy-stats"><div><dt>${esc(x.gates)}</dt><dd id="km-gates">–</dd></div></dl>
      <p><a class="btn btn-ghost" id="km-sim" data-base="${home}tools/logic-circuit-simulator/" href="${home}tools/logic-circuit-simulator/" hidden>${esc(x.to_sim)} →</a></p>
      <p class="muted">${esc(x.note)}</p>
    </section>
    </div>
  </form>`,
    'series-parallel': x => {
      const units = ['1e-12', '1e-9', '1e-6', '1e-3', '1', '1e3', '1e6'];
      const unitSel = (name, value) => `<select name="${name}" data-unit aria-label="${esc(x.unit)}">${units.map(u => `<option value="${u}"${u === value ? ' selected' : ''}>${u}</option>`).join('')}</select>`;
      const rows = [['1', '1e3'], ['2.2', '1e3'], ['', '1e3'], ['', '1e3'], ['', '1e3'], ['', '1e3'], ['', '1e3'], ['', '1e3']];
      return `<form id="sp-form" class="dy-form" data-text="${esc(JSON.stringify({ none: x.none, pair_series: x.pair_series, pair_parallel: x.pair_parallel }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('kind', x.kind, [['r', x.kinds.r], ['c', x.kinds.c], ['l', x.kinds.l]], 'r')}
    <fieldset class="sp-values"><legend>${esc(x.values_heading)}</legend>
      ${rows.map(([v, u], i) => `<div class="sp-row"><span class="muted">${i + 1}</span><input name="v${i}" type="number" inputmode="decimal" min="0" step="any" value="${v}" aria-label="${esc(x.value)} ${i + 1}">${unitSel(`u${i}`, u)}</div>`).join('')}
    </fieldset>
    <fieldset class="sp-values"><legend>${esc(x.target_heading)}</legend>
      <div class="sp-row"><span class="muted">${esc(x.target)}</span><input name="t" type="number" inputmode="decimal" min="0" step="any" value="1.4" aria-label="${esc(x.target)}">${unitSel('tu', '1e3')}</div>
    </fieldset>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('series', x.series)}${stat('parallel', x.parallel)}${stat('count', x.count)}</dl>
    <h3>${esc(x.target_heading)}</h3>
    <dl class="dy-stats">${stat('single', x.single)}</dl>
    <div class="table-wrap"><table class="sp-pairs"><thead><tr><th></th><th>E24</th><th>=</th><th>${esc(x.error)}</th></tr></thead><tbody id="sp-pairs"></tbody></table></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`;
    },
    opamp: x => `<form id="oa-form" class="dy-form" data-text="${esc(JSON.stringify({ zin_high: x.zin_high }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('circuit', x.circuit, Object.entries(x.circuits), 'inv')}
    <div data-show="inv noninv diff">${field('rf', `${x.rf} (kΩ)`, 100, 'min="0" step="any"')}</div>
    <label class="dy-field" data-show="inv noninv diff"><span><span data-show="inv">${esc(x.rin)}</span><span data-show="noninv">${esc(x.rg)}</span><span data-show="diff">${esc(x.r1)}</span> (kΩ)</span><input name="rin" type="number" inputmode="decimal" value="10" min="0" step="any"></label>
    <div data-show="inv noninv follower">${field('vin', `${x.vin} (V)`, 0.5, 'step="any"')}</div>
    <div data-show="diff">${field('v1', `${x.v1} (V)`, 1, 'step="any"')}</div>
    <div data-show="diff">${field('v2', `${x.v2} (V)`, 1.2, 'step="any"')}</div>
    ${field('vpos', `${x.vpos} (V)`, 15, 'step="any"')}
    ${field('vneg', `${x.vneg} (V)`, -15, 'step="any"')}
    <div data-show="inv noninv diff">${field('t', x.target, 10, 'step="any"')}</div>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('gain', x.gain)}${stat('gain_db', x.gain_db)}${stat('vout', x.vout)}${stat('zin', x.zin)}</dl>
    <p class="notice" id="oa-sat" hidden>${esc(x.sat)}</p>
    <h3 data-show="inv noninv diff">${esc(x.target_heading)}</h3>
    <div class="table-wrap" data-show="inv noninv diff"><table class="sp-pairs"><thead><tr><th>Rf</th><th>${esc(x.rin)} / ${esc(x.rg)} / ${esc(x.r1)}</th><th>${esc(x.gain)}</th><th>±</th></tr></thead><tbody id="oa-pairs"></tbody></table></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    crc: x => `<form id="crc-form" class="dy-form" data-text="${esc(JSON.stringify({ remainder: x.remainder, div_none: x.div_none }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('preset', x.preset, [['', x.custom], ['crc-8', 'CRC-8'], ['crc-8-maxim', 'CRC-8/MAXIM (1-Wire)'], ['crc-16-ccitt-false', 'CRC-16/CCITT-FALSE'], ['crc-16-xmodem', 'CRC-16/XMODEM'], ['crc-16-kermit', 'CRC-16/KERMIT'], ['crc-16-modbus', 'CRC-16/MODBUS'], ['crc-16-arc', 'CRC-16/ARC'], ['crc-32', 'CRC-32 (Ethernet, ZIP)'], ['crc-32c', 'CRC-32C (Castagnoli)'], ['crc-32-mpeg2', 'CRC-32/MPEG-2']], 'crc-32')}
    ${select('mode', x.mode, [['text', x.modes.text], ['hex', x.modes.hex]], 'text')}
    <label class="dy-field crc-data"><span>${esc(x.data)}</span><input name="data" type="text" autocomplete="off" spellcheck="false" value="123456789"></label>
    ${select('w', x.w, [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 21, 24, 30, 31, 32, 40, 64].map(v => [String(v), String(v)]), '32')}
    <label class="dy-field"><span>${esc(x.poly)}</span><input name="poly" type="text" autocomplete="off" spellcheck="false" value="0x04C11DB7"></label>
    <label class="dy-field"><span>${esc(x.init)}</span><input name="init" type="text" autocomplete="off" spellcheck="false" value="0xFFFFFFFF"></label>
    <label class="dy-field"><span>${esc(x.xorout)}</span><input name="xorout" type="text" autocomplete="off" spellcheck="false" value="0xFFFFFFFF"></label>
    <label class="crc-check"><input name="refin" type="checkbox" checked> ${esc(x.refin)}</label>
    <label class="crc-check"><input name="refout" type="checkbox" checked> ${esc(x.refout)}</label>
    <p class="notice" id="crc-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats bc-stats">${stat('hex', x.hex)}${stat('bin', x.bin)}${stat('dec', x.dec)}${stat('bytes', x.bytes)}${stat('check', x.check)}${stat('poly', x.polyx)}</dl>
    <div id="crc-div"><h3>${esc(x.div_heading)}</h3><pre class="crc-div"></pre><p class="muted" data-rem></p></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    hamming: x => `<form id="hm-form" class="dy-form" data-text="${esc(JSON.stringify({ info: x.info, st_ok: x.st_ok, st_fixed: x.st_fixed, st_double: x.st_double, st_invalid: x.st_invalid, miscorrect: x.miscorrect }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('k', x.k, [4, 8, 11, 16, 26, 32, 57, 64].map(v => [String(v), String(v)]), '4')}
    <label class="dy-field crc-data"><span>${esc(x.data)}</span><input name="data" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" value="1011"></label>
    <label class="crc-check"><input name="secded" type="checkbox"> ${esc(x.secded)}</label>
    <p class="notice" id="hm-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.code_heading)}</h2>
    <p class="muted" id="hm-info"></p>
    <div class="hm-code" id="hm-code"></div>
    <p class="hm-legend"><span class="hm-key p"></span>${esc(x.legend_p)} <span class="hm-key d"></span>${esc(x.legend_d)} <span class="hm-key all"></span>${esc(x.legend_all)}</p>
    <p><button type="button" class="btn btn-ghost btn-small" id="hm-reset">${esc(x.reset)}</button></p>
    <h3>${esc(x.checks_heading)}</h3>
    <div class="table-wrap"><table class="sp-pairs hm-checks"><thead><tr><th>${esc(x.col_p)}</th><th>${esc(x.col_cover)}</th><th>${esc(x.col_x)}</th></tr></thead><tbody id="hm-checks"></tbody></table></div>
    <h3>${esc(x.out_heading)}</h3>
    <p class="hm-status" id="hm-status"></p>
    <dl class="dy-stats bc-stats"><div><dt>${esc(x.syn)}</dt><dd id="hm-syn">–</dd></div><div><dt>${esc(x.flips)}</dt><dd id="hm-flips">0</dd></div><div><dt>${esc(x.out)}</dt><dd id="hm-out">–</dd></div></dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    subnet: x => `<form id="sn-form" class="dy-form" data-text="${esc(JSON.stringify({ kinds: x.kinds, bin_ip: x.bin_ip, bin_mask: x.bin_mask, split_count: x.split_count, split_more: x.split_more, col_net: x.col_net, col_range: x.col_range, col_bc: x.col_bc, need_result: x.need_result, need_too_many: x.need_too_many }))}">
    <h2>${esc(x.in_heading)}</h2>
    <label class="dy-field"><span>${esc(x.ip)}</span><input name="ip" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="192.168.10.77"></label>
    <label class="dy-field"><span>${esc(x.prefix)}</span><input name="prefix" type="text" autocomplete="off" spellcheck="false" value="/27"></label>
    ${select('split', x.split, [['0', x.split_none], ...Array.from({ length: 25 }, (_, i) => [String(i + 8), `/${i + 8}`])], '0')}
    <label class="dy-field"><span>${esc(x.hosts_need)}</span><input name="need" type="number" inputmode="numeric" min="1" step="1" value="500"></label>
    <p class="notice" id="sn-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats bc-stats">${stat('cidr', x.cidr)}${stat('network', x.network)}${stat('broadcast', x.broadcast)}${stat('first', x.first)}${stat('last', x.last)}${stat('hosts', x.hosts)}${stat('total', x.total)}${stat('mask', x.mask)}${stat('wildcard', x.wildcard)}${stat('kind', x.kind)}${stat('cls', x.cls)}</dl>
    <p class="muted" id="sn-p31" hidden>${esc(x.p31)}</p>
    <h3>${esc(x.bin_heading)}</h3>
    <div class="sn-bin" id="sn-bin"></div>
    <p class="hm-legend"><span class="hm-key sn-net"></span>${esc(x.legend_net)} <span class="hm-key sn-host"></span>${esc(x.legend_host)}</p>
    <h3>${esc(x.split_heading)}</h3>
    <div id="sn-split"></div>
    <h3>${esc(x.need_heading)}</h3>
    <p data-out="need">–</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    queue: x => `<form id="qu-form" class="dy-form" data-text="${esc(JSON.stringify({ chart_x: x.chart_x, chart_y: x.chart_y }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('unit', x.unit, Object.entries(x.units), 's')}
    ${field('lambda', x.lambda, 0.05, 'min="0" step="any"')}
    ${field('ts', x.ts, 10, 'min="0" step="any"')}
    ${field('c', x.c, 1, 'min="1" max="200" step="1"')}
    <p class="notice" id="qu-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p class="notice" id="qu-unstable" hidden>${esc(x.unstable)}</p>
    <dl class="dy-stats">${stat('rho', x.rho)}${stat('mu', x.mu)}${stat('pw', x.pw)}${stat('lq', x.lq)}${stat('l', x.l)}${stat('wq', x.wq)}${stat('w', x.w)}</dl>
    <h3>${esc(x.chart_heading)}</h3>
    <svg id="qu-chart" class="sta-chart qu-chart" viewBox="0 0 600 260" role="img" aria-label="${esc(x.chart_heading)}"></svg>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    availability: x => {
      const rows = [['90', 2, 1], ['95', 1, 1], ['', 1, 1], ['', 1, 1], ['', 1, 1]];
      return `<form id="av-form" class="dy-form" data-text="${esc(JSON.stringify({ h: x.h, min: x.min, sec: x.sec, per_year: x.per_year, times: x.times }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${field('mtbf', x.mtbf, 480, 'min="0" step="any"')}
    ${field('mttr', x.mttr, 20, 'min="0" step="any"')}
    <dl class="dy-stats av-wide">${stat('a1', x.a1)}${stat('down1', x.down1)}${stat('fail1', x.fail1)}</dl>
    <fieldset class="sp-values av-sys"><legend>${esc(x.sys_heading)}</legend>
      <p class="muted av-wide">${esc(x.sys_hint)}</p>
      <div class="av-row av-head"><span>${esc(x.col_a)}</span><span>${esc(x.col_n)}</span><span>${esc(x.col_k)}</span><span>${esc(x.col_g)}</span></div>
      ${rows.map(([a, n, k], i) => `<div class="av-row"><input name="a${i}" type="number" inputmode="decimal" min="0" max="100" step="any" value="${a}" aria-label="${esc(x.col_a)} ${i + 1}"><input name="n${i}" type="number" inputmode="numeric" min="1" max="50" step="1" value="${n}" aria-label="${esc(x.col_n)} ${i + 1}"><input name="k${i}" type="number" inputmode="numeric" min="1" max="50" step="1" value="${k}" aria-label="${esc(x.col_k)} ${i + 1}"><output data-out="g${i}"></output></div>`).join('')}
    </fieldset>
    <p class="notice" id="av-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('total', x.total)}${stat('down', x.down)}${stat('nines', x.nines)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`;
    },
    password: x => `<form id="pw-form" class="dy-form" data-text="${esc(JSON.stringify({ u_s: x.u_s, u_min: x.u_min, u_h: x.u_h, u_d: x.u_d, u_y: x.u_y, instant: x.instant }))}">
    <h2>${esc(x.in_heading)}</h2>
    <label class="dy-field crc-data"><span>${esc(x.sample)}</span><input name="sample" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(x.sample_ph)}"></label>
    <p class="muted crc-data">${esc(x.sample_note)}</p>
    <label class="crc-check"><input name="lower" type="checkbox" checked> ${esc(x.lower)}</label>
    <label class="crc-check"><input name="upper" type="checkbox" checked> ${esc(x.upper)}</label>
    <label class="crc-check"><input name="digit" type="checkbox" checked> ${esc(x.digit)}</label>
    <label class="crc-check"><input name="symbol" type="checkbox"> ${esc(x.symbol)}</label>
    ${field('len', x.len, 8, 'min="1" max="128" step="1"')}
    ${select('rate', x.rate, Object.entries(x.rates), '1e10')}
    <p class="notice" id="pw-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats bc-stats">${stat('n', x.n)}${stat('space', x.space)}${stat('bits', x.bits)}${stat('all', x.all)}${stat('avg', x.avg)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'sql-practice': x => `<section class="dy-out sql" id="sql" data-vendor="${base}vendor/sqljs/" data-text="${esc(JSON.stringify({ schema: x.schema, exercises: x.exercises, rows: x.rows, empty: x.empty, loading: x.loading, ready: x.ready, ok_rows: x.ok_rows, ok_done: x.ok_done, error: x.error, correct: x.correct, wrong: x.wrong, reset_done: x.reset_done, load_error: x.load_error }))}">
    <h2>${esc(x.ex_heading)}</h2>
    <label class="dy-field"><span>${esc(x.ex_label)}</span><select id="sql-ex">${x.exercises.map((e, i) => `<option value="${i}">${i + 1}. ${esc(e.q.length > 40 ? `${e.q.slice(0, 40)}…` : e.q)}</option>`).join('')}</select></label>
    <p class="sql-ex-q" id="sql-ex-q"></p>
    <label class="dy-field"><span>${esc(x.editor)}</span><textarea id="sql-input" class="sql-input" rows="5" spellcheck="false" autocomplete="off" autocapitalize="off">${esc(x.default_sql)}</textarea></label>
    <div class="ls-bar">
      <button type="button" class="btn btn-primary btn-small" id="sql-run">${esc(x.run)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="sql-check">${esc(x.check)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="sql-show">${esc(x.show)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="sql-reset">${esc(x.reset)}</button>
    </div>
    <p class="sql-judge" id="sql-judge" hidden></p>
    <pre class="sql-answer" id="sql-answer" hidden></pre>
    <h3>${esc(x.result_heading)}</h3>
    <p class="sql-status" id="sql-status" aria-live="polite"></p>
    <div id="sql-result"></div>
    <h3>${esc(x.schema_heading)}</h3>
    <div id="sql-schema" class="sql-schema"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    sort: x => `<form id="so-form" class="dy-form" data-text="${esc(JSON.stringify({ play: x.play, pause: x.pause, ev: x.ev, algos: x.algos, stable_yes: x.stable_yes, stable_no: x.stable_no, finished: x.finished }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('algo', x.algo, Object.entries(x.algos), 'quick')}
    ${select('kind', x.kind, Object.entries(x.kinds), 'random')}
    <label class="dy-field"><span>${esc(x.n)} <output data-out="nv">16</output></span><input name="n" type="range" min="4" max="64" step="1" value="16"></label>
    <label class="dy-field"><span>${esc(x.speed)}</span><input name="speed" type="range" min="1" max="10" step="1" value="5"></label>
  </form>
  <section class="dy-out so" aria-live="off">
    <h2>${esc(x.out_heading)}</h2>
    <div class="ls-bar">
      <button type="button" class="btn btn-primary btn-small" id="so-play">${esc(x.play)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="so-step">${esc(x.step)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="so-restart">${esc(x.restart)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="so-new">${esc(x.shuffle)}</button>
    </div>
    <svg id="so-bars" class="so-bars" role="img" aria-label="${esc(x.out_heading)}"></svg>
    <p class="so-ev" id="so-ev">&nbsp;</p>
    <dl class="dy-stats">${stat('cmps', x.cmps)}${stat('writes', x.writes)}${stat('progress', x.progress)}</dl>
    <p class="so-legend"><span class="so-key cmp"></span>${esc(x.lg_cmp)} <span class="so-key write"></span>${esc(x.lg_write)} <span class="so-key done"></span>${esc(x.lg_done)}</p>
    <h3>${esc(x.cmp_heading)}</h3>
    <p class="muted">${esc(x.cmp_hint)}</p>
    <div class="table-wrap"><table class="sp-pairs so-table"><thead><tr><th>${esc(x.col_algo)}</th><th>${esc(x.cmps)}</th><th>${esc(x.writes)}</th><th>${esc(x.col_order)}</th><th>${esc(x.col_stable)}</th></tr></thead><tbody id="so-all"></tbody></table></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    fsm: x => `<form id="fsm-form" class="dy-form fsm-form" data-text="${esc(JSON.stringify({ col_state: x.col_state, col_next0: x.col_next0, col_next1: x.col_next1, col_out: x.col_out, col_out0: x.col_out0, col_out1: x.col_out1, col_t: x.col_t, col_in: x.col_in, col_nextstate: x.col_nextstate, col_output: x.col_output, outseq: x.outseq, time: x.time, min_result: x.min_result, min_unreachable: x.min_unreachable, min_groups: x.min_groups, min_none: x.min_none, examples_desc: x.examples_desc }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, [['', x.example_none], ...Object.entries(x.examples)], 'ones')}
    <p class="muted fsm-exdesc" id="fsm-exdesc"></p>
    ${select('type', x.type, Object.entries(x.types), 'moore')}
    ${select('count', x.count, [1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), String(n)]), '3')}
    <div class="table-wrap fsm-tablewrap" id="fsm-table"></div>
    <label class="dy-field fsm-wide"><span>${esc(x.input)}</span><input name="input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="64" value=""></label>
    <p class="notice fsm-wide" id="fsm-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out fsm" aria-live="off">
    <h2>${esc(x.out_heading)}</h2>
    <svg id="fsm-svg" class="fsm-svg" role="img" aria-label="${esc(x.out_heading)}"></svg>
    <div class="ls-bar fsm-timebar">
      <button type="button" class="btn btn-ghost btn-small" id="fsm-prev" aria-label="${esc(x.prev)}">◀</button>
      <input type="range" id="fsm-time" min="0" max="0" value="0" aria-label="${esc(x.prev)} / ${esc(x.next)}">
      <button type="button" class="btn btn-ghost btn-small" id="fsm-next" aria-label="${esc(x.next)}">▶</button>
      <span id="fsm-tlabel"></span>
    </div>
    <p class="fsm-outseq" id="fsm-outseq"></p>
    <div class="table-wrap" id="fsm-trace"></div>
    <h3>${esc(x.min_heading)}</h3>
    <div id="fsm-min"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    rpn: x => `<form id="rpn-form" class="dy-form rpn-form" data-text="${esc(JSON.stringify({ err: x.err, col_token: x.col_token, col_action: x.col_action, col_stack: x.col_stack, col_output: x.col_output, col_calc: x.col_calc, col_stack_after: x.col_stack_after, act_output: x.act_output, act_push: x.act_push, act_pop_push: x.act_pop_push, act_paren: x.act_paren, act_paren_pop: x.act_paren_pop, act_end: x.act_end, act_pushval: x.act_pushval, need_values: x.need_values }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, [['', x.example_none], ...x.examples.map(e => [`${e.mode}|${e.expr}`, e.label])], '')}
    ${select('mode', x.mode, Object.entries(x.modes), 'infix')}
    <label class="dy-field rpn-wide"><span>${esc(x.expr)}</span><input name="expr" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" value="(A + B) * (C - D)" class="rpn-expr"></label>
    <p class="muted rpn-wide">${esc(x.expr_hint)}</p>
    <p class="muted rpn-wide" id="rpn-vars-hint" hidden>${esc(x.vars_hint)}</p>
    <div class="rpn-vars rpn-wide" id="rpn-vars" hidden></div>
    <p class="notice rpn-wide" id="rpn-error" hidden></p>
  </form>
  <section class="dy-out rpn" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats rpn-results">${stat('postfix', x.postfix)}${stat('prefix', x.prefix)}${stat('infix', x.infix)}${stat('value', x.value)}</dl>
    <h3>${esc(x.tree_heading)}</h3>
    <svg id="rpn-tree" class="rpn-tree" role="img" aria-label="${esc(x.tree_heading)}"></svg>
    <h3 id="rpn-steps-h">${esc(x.steps_heading)}</h3>
    <div class="table-wrap" id="rpn-steps"></div>
    <h3>${esc(x.eval_heading)}</h3>
    <div class="table-wrap" id="rpn-eval"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    paging: x => `<form id="pg-form" class="dy-form pg-form" data-text="${esc(JSON.stringify({ row_ref: x.row_ref, row_frame: x.row_frame, row_fault: x.row_fault, row_victim: x.row_victim, col_algo: x.col_algo, algos: x.algos }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, [['', x.example_none], ...x.examples.map(e => [`${e.refs}|${e.frames}`, e.label])], '')}
    <label class="dy-field pg-wide"><span>${esc(x.refs)}</span><input name="refs" type="text" autocomplete="off" spellcheck="false" value="7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1"></label>
    ${field('frames', x.frames, 3, 'min="1" max="8" step="1"')}
    ${select('algo', x.algo, Object.entries(x.algos), 'lru')}
    <p class="notice pg-wide" id="pg-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out pg" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('faults', x.faults)}${stat('hits', x.hits)}${stat('rate', x.rate)}</dl>
    <div class="table-wrap" id="pg-grid"></div>
    <p class="muted">${esc(x.grid_hint)}</p>
    <h3>${esc(x.cmp_heading)}</h3>
    <p class="muted">${esc(x.cmp_hint)}</p>
    <div class="table-wrap" id="pg-cmp"></div>
    <p class="notice" id="pg-belady" hidden>${esc(x.belady)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    sched: x => `<form id="sc-form" class="dy-form sc-form" data-text="${esc(JSON.stringify({ examples: x.examples, algos: x.algos, idle: x.idle, col_name: x.col_name, col_arrival: x.col_arrival, col_burst: x.col_burst, col_prio: x.col_prio, col_end: x.col_end, col_tat: x.col_tat, col_wait: x.col_wait, col_resp: x.col_resp, col_algo: x.col_algo, avg_tat: x.avg_tat, avg_wait: x.avg_wait, avg_resp: x.avg_resp, col_switch: x.col_switch }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${select('algo', x.algo, Object.entries(x.algos), 'fcfs')}
    <div id="sc-q">${field('q', x.q, 2, 'min="1" max="50" step="1"')}</div>
    <div class="table-wrap sc-wide"><table class="sc-edit"><thead><tr><th>${esc(x.col_name)}</th><th>${esc(x.col_arrival)}</th><th>${esc(x.col_burst)}</th><th>${esc(x.col_prio)}</th></tr></thead><tbody>${
      Array.from({ length: 8 }, (_, i) => `<tr><td><input name="n${i}" maxlength="6" aria-label="${esc(x.col_name)} ${i + 1}"></td><td><input name="a${i}" type="number" inputmode="numeric" min="0" max="999" step="1" aria-label="${esc(x.col_arrival)} ${i + 1}"></td><td><input name="b${i}" type="number" inputmode="numeric" min="1" max="99" step="1" aria-label="${esc(x.col_burst)} ${i + 1}"></td><td><input name="p${i}" type="number" inputmode="numeric" step="1" aria-label="${esc(x.col_prio)} ${i + 1}"></td></tr>`).join('')}</tbody></table></div>
    <p class="muted sc-wide">${esc(x.table_hint)}</p>
    <p class="notice sc-wide" id="sc-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out sc" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <svg id="sc-gantt" class="sc-gantt" role="img" aria-label="${esc(x.gantt)}"></svg>
    <dl class="dy-stats">${stat('tat', x.avg_tat)}${stat('wait', x.avg_wait)}${stat('resp', x.avg_resp)}${stat('end', x.makespan)}</dl>
    <div class="table-wrap" id="sc-rows"></div>
    <h3>${esc(x.cmp_heading)}</h3>
    <div class="table-wrap" id="sc-cmp"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    dijkstra: x => `<form id="dj-form" class="dy-form dj-form" data-text="${esc(JSON.stringify({ examples: x.examples, step0: x.step0, stepmsg: x.stepmsg, updated: x.updated, no_update: x.no_update, unreachable: x.unreachable, col_round: x.col_round, col_fix: x.col_fix, err_line: x.err_line, err_many: x.err_many, err_empty: x.err_empty }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    <label class="dy-field dj-wide"><span>${esc(x.edges)}</span><textarea name="edges" rows="7" spellcheck="false" autocomplete="off" autocapitalize="off" class="dj-edges"></textarea></label>
    <p class="muted dj-wide">${esc(x.edges_hint)}</p>
    <label class="crc-check dj-wide"><input type="checkbox" name="directed"> ${esc(x.directed)}</label>
    <label class="dy-field"><span>${esc(x.source)}</span><select name="source"></select></label>
    <label class="dy-field"><span>${esc(x.target)}</span><select name="target"></select></label>
    <p class="notice dj-wide" id="dj-error" hidden></p>
  </form>
  <section class="dy-out dj" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('dist', x.dist)}${stat('path', x.path)}</dl>
    <svg id="dj-svg" class="dj-svg" role="img" aria-label="${esc(x.graph)}"></svg>
    <div class="ls-bar dj-bar">
      <button type="button" class="btn btn-ghost btn-small" id="dj-prev" aria-label="${esc(x.prev)}">◀</button>
      <input type="range" id="dj-step" min="0" max="0" value="0" aria-label="${esc(x.col_round)}">
      <button type="button" class="btn btn-ghost btn-small" id="dj-next" aria-label="${esc(x.next)}">▶</button>
    </div>
    <p class="dj-msg" id="dj-msg"></p>
    <p class="so-legend"><span class="so-key dj-cur"></span>${esc(x.lg_cur)} <span class="so-key dj-done"></span>${esc(x.lg_done)} <span class="so-key write"></span>${esc(x.lg_relax)} <span class="so-key dj-path"></span>${esc(x.lg_path)}</p>
    <h3>${esc(x.table_heading)}</h3>
    <p class="muted">${esc(x.table_hint)}</p>
    <div class="table-wrap" id="dj-table"></div>
    <p class="dj-all"><strong>${esc(x.all)}</strong> <span id="dj-all"></span></p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    bintree: x => `<form id="bt-form" class="dy-form bt-form" data-text="${esc(JSON.stringify({ examples: x.examples, dup: x.dup, del_missing: x.del_missing, del_two: x.del_two, del_ok: x.del_ok, found: x.found, not_found: x.not_found, swaps: x.swaps }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${select('mode', x.mode, Object.entries(x.modes), 'bst')}
    <label class="dy-field bt-wide"><span>${esc(x.keys)}</span><input name="keys" type="text" autocomplete="off" spellcheck="false"></label>
    <label class="dy-field bt-bst"><span>${esc(x.del)}</span><input name="del" type="text" autocomplete="off" spellcheck="false"></label>
    <label class="dy-field bt-bst"><span>${esc(x.find)}</span><input name="find" type="text" autocomplete="off" spellcheck="false" maxlength="6"></label>
    <label class="dy-field bt-heap" hidden><span>${esc(x.pops)}</span><input name="pops" type="number" inputmode="numeric" min="0" max="40" step="1" value="0"></label>
    <p class="muted bt-wide">${esc(x.keys_hint)}</p>
    <p class="notice bt-wide" id="bt-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out bt" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <svg id="bt-svg" class="bt-svg" role="img" aria-label="${esc(x.out_heading)}"></svg>
    <ul class="bt-notes" id="bt-notes"></ul>
    <dl class="dy-stats bt-stats">${stat('pre', x.pre)}${stat('in', x.in)}${stat('post', x.post)}${stat('level', x.level)}${stat('height', x.height)}${stat('size', x.size)}</dl>
    <dl class="dy-stats bt-stats bt-bst">${stat('search', x.search)}</dl>
    <dl class="dy-stats bt-stats bt-heap" hidden>${stat('array', x.array)}${stat('popped', x.popped)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    hash: x => `<form id="hs-form" class="dy-form hs-form" data-text="${esc(JSON.stringify({ examples: x.examples, methods: x.methods, found: x.found, not_found: x.not_found, pos: x.pos, empty: x.empty, full: x.full, dup: x.dup, h2_note: x.h2_note, col_key: x.col_key, col_code: x.col_code, col_seq: x.col_seq, col_pos: x.col_pos, col_probes: x.col_probes, col_method: x.col_method, col_coll: x.col_coll, col_avg: x.col_avg, col_max: x.col_max, col_fail: x.col_fail }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    <label class="dy-field hs-wide"><span>${esc(x.keys)}</span><input name="keys" type="text" autocomplete="off" spellcheck="false"></label>
    ${field('m', x.m, 7, 'min="2" max="64" step="1"')}
    ${select('method', x.method, Object.entries(x.methods), 'linear')}
    <label class="dy-field"><span>${esc(x.find)}</span><input name="find" type="text" autocomplete="off" spellcheck="false" maxlength="8"></label>
    <p class="muted hs-wide">${esc(x.keys_hint)}</p>
    <p class="notice hs-wide" id="hs-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out hs" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('load', x.load)}${stat('coll', x.coll)}${stat('avg', x.avg)}</dl>
    <p class="hs-search"><strong>${esc(x.search)}</strong> <span data-out="search">–</span></p>
    <div class="table-wrap" id="hs-table"></div>
    <p class="muted" id="hs-h2"></p>
    <h3>${esc(x.recs_heading)}</h3>
    <div class="table-wrap" id="hs-recs"></div>
    <h3>${esc(x.cmp_heading)}</h3>
    <div class="table-wrap" id="hs-cmp"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    bigo: x => `<form id="bo-form" class="dy-form bo-form" data-text="${esc(JSON.stringify({ col_order: x.col_order, col_steps: x.col_steps, col_time: x.col_time, col_example: x.col_example, examples: x.order_examples, times: x.times, u_ns: x.u_ns, u_us: x.u_us, u_ms: x.u_ms, u_s: x.u_s, u_min: x.u_min, u_h: x.u_h, u_d: x.u_d, u_y: x.u_y }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${field('n', x.n, 1000, 'min="1" max="1000000000" step="1"')}
    ${field('ops', x.ops, 100000000, 'min="1" step="any"')}
    <p class="notice bo-wide" id="bo-error" hidden>${esc(x.invalid)}</p>
    <h3 class="bo-wide">${esc(x.est_heading)}</h3>
    ${select('order', x.order, ['1', 'log n', 'n', 'n log n', 'n²', 'n³', '2ⁿ', 'n!'].map((v, i) => [String(i), `O(${v})`]), '4')}
    ${field('n1', x.n1, 1000, 'min="1" step="1"')}
    ${field('t1', x.t1, 0.5, 'min="0" step="any"')}
    ${field('n2', x.n2, 4000, 'min="1" step="1"')}
    <dl class="dy-stats bo-wide">${stat('ratio', x.ratio)}${stat('t2', x.t2)}</dl>
  </form>
  <section class="dy-out bo" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <div class="table-wrap" id="bo-table"></div>
    <h3>${esc(x.chart_heading)}</h3>
    <svg id="bo-chart" class="sta-chart bo-chart" viewBox="0 0 600 280" role="img" aria-label="${esc(x.chart_heading)}"></svg>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    cpm: x => `<form id="cp-form" class="dy-form cp-form" data-text="${esc(JSON.stringify({ examples: x.examples, err: x.err, unit: x.unit, or: x.or, col_task: x.col_task, col_d: x.col_d, col_pre: x.col_pre, col_es: x.col_es, col_ef: x.col_ef, col_ls: x.col_ls, col_lf: x.col_lf, col_tf: x.col_tf, col_ff: x.col_ff }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    <label class="dy-field cp-wide"><span>${esc(x.tasks)}</span><textarea name="tasks" rows="8" spellcheck="false" autocomplete="off" autocapitalize="off" class="dj-edges"></textarea></label>
    <p class="muted cp-wide">${esc(x.tasks_hint)}</p>
    <p class="notice cp-wide" id="cp-error" hidden></p>
  </form>
  <section class="dy-out cp" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('total', x.total)}${stat('path', x.path)}</dl>
    <svg id="cp-gantt" class="cp-gantt" role="img" aria-label="${esc(x.gantt)}"></svg>
    <p class="so-legend"><span class="so-key cp-crit"></span>${esc(x.lg_crit)} <span class="so-key cp-task"></span>${esc(x.lg_task)} <span class="so-key cp-slack"></span>${esc(x.lg_slack)}</p>
    <div class="table-wrap" id="cp-table"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    evm: x => `<form id="ev-form" class="dy-form ev-form" data-text="${esc(JSON.stringify({ examples: x.examples, now: x.now_label, behind: x.behind, ahead: x.ahead, on_time: x.on_time, over: x.over, under: x.under, on_budget: x.on_budget }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${field('bac', x.bac, 1000, 'min="0" step="any"')}
    ${field('pv', x.pv, 500, 'min="0" step="any"')}
    ${field('ev', x.ev, 400, 'min="0" step="any"')}
    ${field('ac', x.ac, 450, 'min="0" step="any"')}
    ${field('now', x.now, 50, 'min="0" max="100" step="any"')}
    <p class="notice ev-wide" id="ev-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out ev" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p class="ev-verdict" id="ev-verdict"></p>
    <dl class="dy-stats">${stat('sv', x.sv)}${stat('cv', x.cv)}${stat('spi', x.spi)}${stat('cpi', x.cpi)}${stat('done', x.done)}</dl>
    <h3>${esc(x.fc_heading)}</h3>
    <dl class="dy-stats">${stat('eac', x.eac)}${stat('eacPlan', x.eac_plan)}${stat('eacBoth', x.eac_both)}${stat('etc', x.etc)}${stat('vac', x.vac)}${stat('tcpi', x.tcpi)}</dl>
    <svg id="ev-chart" class="sta-chart ev-chart" viewBox="0 0 600 240" role="img" aria-label="${esc(x.chart)}"></svg>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    transfer: x => `<form id="tf-form" class="dy-form tf-form" data-text="${esc(JSON.stringify({ examples: x.examples, steps: x.steps, u_s: x.u_s, u_min: x.u_min, u_h: x.u_h }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${field('size', x.size, 1, 'min="0" step="any"')}
    ${select('sunit', x.sunit, ['B', 'kB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB', 'TiB'].map(u => [u, u]), 'GB')}
    ${field('rate', x.rate, 100, 'min="0" step="any"')}
    ${select('runit', x.runit, ['bps', 'kbps', 'Mbps', 'Gbps'].map(u => [u, u]), 'Mbps')}
    ${field('eff', x.eff, 80, 'min="0" max="100" step="any"')}
    ${field('target', x.target, 60, 'min="0" step="any"')}
    <p class="muted tf-wide">${esc(x.unit_hint)}</p>
    <p class="notice tf-wide" id="tf-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('time', x.time)}${stat('bits', x.bits)}${stat('erate', x.erate)}${stat('need', x.need)}</dl>
    <p class="tf-steps" id="tf-steps"></p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    media: x => `<form id="md-form" class="dy-form md-form" data-text="${esc(JSON.stringify({ examples: x.examples, sec: x.sec_unit, steps_image: x.steps_image, steps_audio: x.steps_audio, steps_video: x.steps_video }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${select('kind', x.kind, Object.entries(x.kinds), 'image')}
    <div data-kind="image video">${field('w', x.w, 1920, 'min="1" step="1"')}</div>
    <div data-kind="image video">${field('h', x.h, 1080, 'min="1" step="1"')}</div>
    <div data-kind="image video">${field('bpp', x.bpp, 24, 'min="1" step="1"')}</div>
    <div data-kind="video">${field('fps', x.fps, 30, 'min="0" step="any"')}</div>
    <div data-kind="video" class="md-wide"><label class="crc-check"><input type="checkbox" name="audio"> ${esc(x.audio)}</label></div>
    <div data-kind="audio video">${field('fs', x.fs, 44.1, 'min="0" step="any"')}</div>
    <div data-kind="audio video">${field('qbits', x.qbits, 16, 'min="1" step="1"')}</div>
    <div data-kind="audio video">${field('ch', x.ch, 2, 'min="1" step="1"')}</div>
    <div data-kind="audio video">${field('sec', x.secs, 60, 'min="0" step="any"')}</div>
    ${field('ratio', x.ratio, 1, 'min="0" step="any"')}
    ${field('line', x.line, 100, 'min="0" step="any"')}
    <p class="notice md-wide" id="md-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('raw', x.raw)}${stat('comp', x.comp)}${stat('rate', x.rate)}${stat('time', x.time)}</dl>
    <p class="tf-steps" id="md-steps"></p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    pseudo: x => `<form id="ps-form" class="dy-form ps-form" data-text="${esc(JSON.stringify({ examples: x.examples, err: x.err, pos: x.pos, line: x.line, in_fn: x.in_fn, cond: x.cond, ret: x.ret, out: x.out_note, call: x.call, calls: x.calls, col_var: x.col_var, col_val: x.col_val, no_vars: x.no_vars, no_output: x.no_output }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    <label class="dy-field ps-wide"><span>${esc(x.code)}</span><textarea name="code" rows="14" spellcheck="false" autocomplete="off" autocapitalize="off" class="sql-input ps-code"></textarea></label>
    <div class="ls-bar ps-wide"><button type="button" class="btn btn-primary btn-small" id="ps-run">${esc(x.run)}</button></div>
    <details class="ps-wide ps-help"><summary>${esc(x.help_summary)}</summary><pre>${esc(x.help)}</pre></details>
    <p class="notice ps-wide" id="ps-error" hidden></p>
  </form>
  <section class="dy-out ps" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <pre class="ps-output" id="ps-output"></pre>
    <p class="muted" id="ps-calls"></p>
    <h3>${esc(x.trace_heading)}</h3>
    <div class="ls-bar ps-bar">
      <button type="button" class="btn btn-ghost btn-small" id="ps-prev" aria-label="${esc(x.prev)}">◀</button>
      <input type="range" id="ps-step" min="0" max="0" value="0" aria-label="${esc(x.trace_heading)}">
      <button type="button" class="btn btn-ghost btn-small" id="ps-next" aria-label="${esc(x.next)}">▶</button>
      <button type="button" class="btn btn-ghost btn-small" id="ps-end">${esc(x.to_end)}</button>
      <span id="ps-pos" class="muted"></span>
    </div>
    <p class="ps-note" id="ps-note"></p>
    <div class="ps-grid">
      <div class="ps-listing" id="ps-listing"></div>
      <div class="table-wrap" id="ps-vars"></div>
    </div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    breakeven: x => `<form id="be-form" class="dy-form be-form" data-text="${esc(JSON.stringify({ examples: x.examples, units: x.units, lg_sales: x.lg_sales, lg_cost: x.lg_cost, lg_fixed: x.lg_fixed, lg_bep: x.lg_bep, lg_now: x.lg_now }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${field('sales', x.sales, 1000, 'min="0" step="any"')}
    ${field('vc', x.vc, 600, 'min="0" step="any"')}
    ${field('fc', x.fc, 300, 'min="0" step="any"')}
    ${field('target', x.target, 100, 'min="0" step="any"')}
    <h3 class="be-wide">${esc(x.unit_heading)}</h3>
    ${field('price', x.price, 0, 'min="0" step="any"')}
    ${field('uvc', x.uvc, 0, 'min="0" step="any"')}
    <p class="notice be-wide" id="be-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('bep', x.bep)}${stat('profit', x.profit)}${stat('vr', x.vr)}${stat('mr', x.mr)}${stat('ratio', x.ratio)}${stat('safety', x.safety)}${stat('need', x.need)}${stat('qty', x.qty)}</dl>
    <svg id="be-chart" class="sta-chart be-chart" viewBox="0 0 600 300" role="img" aria-label="${esc(x.chart)}"></svg>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    npv: x => `<form id="nv-form" class="dy-form nv-form" data-text="${esc(JSON.stringify({ examples: x.examples, years: x.years, not_recovered: x.not_recovered, go: x.go, nogo: x.nogo, even: x.even, col_year: x.col_year, col_cf: x.col_cf, col_df: x.col_df, col_pv: x.col_pv, col_acc: x.col_acc, col_accpv: x.col_accpv }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${field('inv', x.inv, 1000, 'min="0" step="any"')}
    ${field('rate', x.rate, 5, 'step="any"')}
    <label class="dy-field nv-wide"><span>${esc(x.cfs)}</span><input name="cfs" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
    <p class="notice nv-wide" id="nv-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p class="ev-verdict" data-out="verdict"></p>
    <dl class="dy-stats">${stat('npv', x.npv)}${stat('irr', x.irr)}${stat('pi', x.pi)}${stat('payback', x.payback)}${stat('dpayback', x.dpayback)}</dl>
    <div class="table-wrap" id="nv-table"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    raid: x => `<form id="rd-form" class="dy-form" data-text="${esc(JSON.stringify({ invalid: x.invalid_by_level, unit: x.unit, disk: x.disk, tol_n: x.tol_n, tol_range: x.tol_range, na: x.na, col_level: x.col_level, col_usable: x.col_usable, col_eff: x.col_eff, col_tol: x.col_tol, col_lose: x.col_lose }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('level', x.level, ['0', '1', '5', '6', '10'].map(l => [l, `RAID ${l}`]), '5')}
    ${field('n', x.n, 6, 'min="1" max="64" step="1"')}
    ${field('size', x.size, 4, 'min="0" step="any"')}
    ${field('afr', x.afr, 2, 'min="0" max="100" step="any"')}
    <p class="notice" id="rd-error" hidden></p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('usable', x.usable)}${stat('eff', x.eff)}${stat('tol', x.tol)}${stat('lose', x.lose)}</dl>
    <div id="rd-fig"></div>
    <p class="muted">${esc(x.fig_hint)}</p>
    <h3>${esc(x.cmp_heading)}</h3>
    <div class="table-wrap" id="rd-cmp"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    bitops: x => `<form id="bo2-form" class="dy-form" data-text="${esc(JSON.stringify({ col_bits: x.col_bits, col_dec: x.col_dec, col_hex: x.col_hex, logic: x.logic, shifts: x.shifts, logical: x.logical, arith: x.arith, rotl: x.rotl, rotr: x.rotr }))}">
    <h2>${esc(x.in_heading)}</h2>
    <label class="dy-field"><span>${esc(x.a)}</span><input name="a" type="text" autocomplete="off" spellcheck="false" value="0b10110100"></label>
    <label class="dy-field"><span>${esc(x.b)}</span><input name="b" type="text" autocomplete="off" spellcheck="false" value="0x0F"></label>
    ${select('w', x.w, [['8', '8'], ['16', '16'], ['32', '32'], ['64', '64']], '8')}
    ${field('k', x.k, 2, 'min="0" max="64" step="1"')}
    <p class="muted" style="grid-column: 1 / -1; margin: 0">${esc(x.hint)}</p>
    <p class="notice" id="bo2-error" hidden style="grid-column: 1 / -1">${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <div class="table-wrap" id="bo2-table"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    cmatrix: x => `<form id="cm-form" class="dy-form cm-form" data-text="${esc(JSON.stringify({ examples: x.examples, pred: x.pred, actual: x.actual, pos: x.pos, neg: x.neg, c_tp: x.c_tp, c_fn: x.c_fn, c_fp: x.c_fp, c_tn: x.c_tn }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${field('tp', x.tp, 40, 'min="0" step="1"')}
    ${field('fn', x.fn, 10, 'min="0" step="1"')}
    ${field('fp', x.fp, 20, 'min="0" step="1"')}
    ${field('tn', x.tn, 130, 'min="0" step="1"')}
    ${field('beta', x.beta, 1, 'min="0.1" step="any"')}
    <p class="notice cm-wide" id="cm-error" hidden>${esc(x.invalid)}</p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <div class="table-wrap" id="cm-matrix"></div>
    <dl class="dy-stats">${stat('accuracy', x.accuracy)}${stat('precision', x.precision)}${stat('recall', x.recall)}${stat('f1', x.f1)}${stat('fbeta', x.fbeta_out)}${stat('specificity', x.specificity)}${stat('fpr', x.fpr)}${stat('npv', x.npv)}${stat('balanced', x.balanced)}${stat('mcc', x.mcc)}${stat('prevalence', x.prevalence)}${stat('n', x.n)}</dl>
    <p class="notice" id="cm-warn" hidden>${esc(x.warn)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    convnet: x => `<form id="cn-form" class="dy-form cn-form" data-text="${esc(JSON.stringify({ examples: x.examples, bad_input: x.bad_input, bad_line: x.bad_line, empty: x.empty, after_fc: x.after_fc, too_small: x.too_small, op_conv: x.op_conv, op_pool: x.op_pool, op_fc: x.op_fc, op_flatten: x.op_flatten, input: x.input, col_layer: x.col_layer, col_shape: x.col_shape, col_params: x.col_params, col_macs: x.col_macs }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${field('h', x.h, 32, 'min="1" step="1"')}
    ${field('w', x.w, 32, 'min="1" step="1"')}
    ${field('c', x.c, 1, 'min="1" step="1"')}
    <label class="dy-field cn-wide"><span>${esc(x.layers)}</span><textarea name="layers" rows="8" spellcheck="false" autocomplete="off"></textarea></label>
    <p class="muted cn-wide">${esc(x.syntax)}</p>
    <label class="cn-check cn-wide"><input type="checkbox" name="bias" checked> ${esc(x.bias)}</label>
    <p class="notice cn-wide" id="cn-error" hidden></p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('out', x.out)}${stat('params', x.params)}${stat('macs', x.macs)}</dl>
    <div class="table-wrap" id="cn-table"></div>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    cvss: x => `<form id="cv-form" class="dy-form cv-form" data-text="${esc(JSON.stringify({ examples: x.examples, sev: x.sev }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    <label class="dy-field cv-wide"><span>${esc(x.vec)}</span><input name="vec" type="text" autocomplete="off" spellcheck="false" class="cv-vec"></label>
    <p class="notice cv-wide" id="cv-error" hidden>${esc(x.invalid)}</p>
    ${['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'].map(k => select(k, x.metrics[k].label, Object.entries(x.metrics[k].opts), Object.keys(x.metrics[k].opts)[0])).join('\n    ')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('base', x.base)}${stat('severity', x.severity)}${stat('impact', x.impact)}${stat('expl', x.expl)}</dl>
    <p class="cv-vector"><span>${esc(x.vector_out)}</span> <code data-out="vector"></code></p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    huffman: x => `<form id="hf-form" class="dy-form hf-form" data-text="${esc(JSON.stringify({ examples: x.examples, bits: x.bits, vs_fixed: x.vs_fixed, col_sym: x.col_sym, col_p: x.col_p, col_count: x.col_count, col_code: x.col_code, col_len: x.col_len, step: x.step, few: x.few, dup: x.dup, bad_line: x.bad_line }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${select('mode', x.mode, [['symbols', x.mode_symbols], ['text', x.mode_text]], 'symbols')}
    <label class="dy-field hf-wide hf-sym"><span>${esc(x.symbols)}</span><textarea name="symbols" rows="6" spellcheck="false" autocomplete="off"></textarea></label>
    <label class="dy-field hf-wide hf-txt"><span>${esc(x.text)}</span><textarea name="text" rows="3" spellcheck="false" autocomplete="off"></textarea></label>
    <p class="notice hf-wide" id="hf-error" hidden></p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('H', x.H)}${stat('L', x.L)}${stat('eff', x.eff)}${stat('fixed', x.fixed)}${stat('ratio', x.ratio)}${stat('total', x.total)}</dl>
    <div class="table-wrap" id="hf-table"></div>
    <h3>${esc(x.steps_heading)}</h3>
    <ol class="hf-steps" id="hf-steps"></ol>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    pid: x => `<form id="pid-form" class="dy-form pid-form" data-plant="fo" data-text="${esc(JSON.stringify({ examples: x.examples, sec: x.sec, unstable: x.unstable, not_settled: x.not_settled, x_label: x.x_label, y_label: x.y_label, u_label: x.u_label }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${select('plant', x.plant, ['fo', 'fopdt', 'so', 'int'].map(k => [k, x[`plant_${k}`]]), 'fo')}
    ${field('K', x.K, 1, 'step="any"')}
    ${field('T', x.T, 5, 'min="0" step="any"').replace('class="dy-field"', 'class="dy-field pid-T"')}
    ${field('zeta', x.zeta, 0.5, 'min="0" step="any"').replace('class="dy-field"', 'class="dy-field pid-so"')}
    ${field('wn', x.wn, 1, 'min="0" step="any"').replace('class="dy-field"', 'class="dy-field pid-so"')}
    ${field('L', x.L, 2, 'min="0" step="any"').replace('class="dy-field"', 'class="dy-field pid-L"')}
    ${field('kp', x.kp, 4, 'step="any"')}
    ${field('ki', x.ki, 1, 'min="0" step="any"')}
    ${field('kd', x.kd, 0, 'min="0" step="any"')}
    ${field('N', x.N, 10, 'min="1" step="any"')}
    ${field('umax', x.umax, 0, 'min="0" step="any"')}
    <label class="crc-check"><input name="aw" type="checkbox"> ${esc(x.aw)}</label>
    ${field('tend', x.tend, 30, 'min="0.001" step="any"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <p class="notice" id="pid-warn" hidden></p>
    <dl class="dy-stats">${stat('final', x.final)}${stat('ess', x.ess)}${stat('overshoot', x.overshoot)}${stat('rise', x.rise)}${stat('settle', x.settle)}${stat('umaxv', x.umaxv)}</dl>
    <svg id="pid-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}"></svg>
    <svg id="pid-u-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_u_label)}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    bode: x => `<form id="bode-form" class="dy-form bode-form" data-text="${esc(JSON.stringify({ examples: x.examples, bad_num: x.bad_num, bad_den: x.bad_den, improper: x.improper, integrator: x.integrator, none: x.none, inf: x.inf, cl_stable: x.cl_stable, cl_unstable: x.cl_unstable, cl_delay: x.cl_delay, x_label: x.x_label, mag_label: x.mag_label, phase_label: x.phase_label }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    <label class="dy-field"><span>${esc(x.num)}</span><input name="num" type="text" value="${esc(x.examples[0].num)}" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
    <label class="dy-field"><span>${esc(x.den)}</span><input name="den" type="text" value="${esc(x.examples[0].den)}" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
    ${field('L', x.L, 0, 'min="0" step="any"')}
    <p class="muted bode-wide">${esc(x.hint)}</p>
    <p class="notice bode-wide" id="bode-error" hidden></p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('wgc', x.wgc)}${stat('pm', x.pm)}${stat('wpc', x.wpc)}${stat('gm', x.gm)}${stat('dc', x.dc)}${stat('cl', x.cl)}${stat('poles', x.poles)}${stat('zeros', x.zeros)}</dl>
    <svg id="bode-mag" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.mag_chart_label)}"></svg>
    <svg id="bode-phase" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.phase_chart_label)}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    dcdc: x => `<form id="dc-form" class="dy-form" data-text="${esc(JSON.stringify({ examples: x.examples, ccm: x.ccm, dcm: x.dcm, dcm_note: x.dcm_note, buck_range: x.buck_range, boost_range: x.boost_range, positive: x.positive, x_label: x.x_label, y_label: x.y_label }))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('example', x.example, x.examples.map((e, i) => [String(i), e.label]), '0')}
    ${select('topo', x.topo, [['buck', x.topo_buck], ['boost', x.topo_boost], ['buckboost', x.topo_buckboost]], 'buck')}
    ${field('vin', x.vin, 12, 'min="0" step="any"')}
    ${field('vout', x.vout, 3.3, 'min="0" step="any"')}
    ${field('iout', x.iout, 2, 'min="0" step="any"')}
    ${field('f', x.f, 500, 'min="0" step="any"')}<input type="hidden" name="fu" value="1000">
    ${field('L', x.L, 4.7, 'min="0" step="any"')}<input type="hidden" name="Lu" value="0.000001">
    ${field('C', x.C, 22, 'min="0" step="any"')}<input type="hidden" name="Cu" value="0.000001">
    ${field('esr', x.esr, 5, 'min="0" step="any"')}<input type="hidden" name="esru" value="0.001">
    <p class="notice crc-check" id="dc-error" hidden></p>
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('mode', x.mode)}${stat('D', x.D)}${stat('iavg', x.iavg)}${stat('di', x.di)}${stat('ipk', x.ipk)}${stat('icrit', x.icrit)}${stat('dv', x.dv)}${stat('L30', x.L30)}</dl>
    <p class="muted" id="dc-note"></p>
    <svg id="dc-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    'logic-sim': x => `<section class="dy-out ls" id="ls" data-text="${esc(JSON.stringify({ pause: x.pause, resume: x.resume, share: x.share, copied: x.copied, table_none: x.table_none, confirm_clear: x.confirm_clear }))}">
    <h2 class="visually-hidden">${esc(x.h1)}</h2>
    <div class="ls-bar" role="toolbar" aria-label="${esc(x.palette)}">
      <span class="ls-bar-label">${esc(x.palette)}</span>
      ${['in', 'out', 'clk', 'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'dff'].map(k => `<button type="button" class="btn btn-ghost btn-small" data-add="${k}">${esc(x.parts[k])}</button>`).join('')}
    </div>
    <div class="ls-bar">
      <label class="ls-ex"><span class="visually-hidden">${esc(x.examples)}</span><select id="ls-example"><option value="">${esc(x.examples)}</option>${Object.entries(x.ex).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <button type="button" class="btn btn-ghost btn-small" id="ls-del" disabled>${esc(x.del)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="ls-clear">${esc(x.clear)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="ls-pause" hidden>${esc(x.pause)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="ls-step" hidden>${esc(x.step)}</button>
      <button type="button" class="btn btn-ghost btn-small" id="ls-share">${esc(x.share)}</button>
    </div>
    <div class="ls-canvas"><svg id="ls-svg" width="800" height="480" viewBox="0 0 800 480" role="img" aria-label="${esc(x.h1)}"></svg></div>
    <p class="notice" id="ls-unstable" hidden>${esc(x.unstable)}</p>
    <p class="muted">${esc(x.hint)}</p>
    <h3>${esc(x.table)}</h3>
    <div id="ls-table"></div>
  </section>`,
    dbm: x => `<form id="db-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('dbm', x.dbm, 0, 'step="0.1"')}
    ${field('mw', x.mw, 1, 'min="0" step="any"')}
    ${field('r', x.r, 50, 'min="0" step="any"')}
    ${field('db', x.db, 3, 'step="0.1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('w', x.w)}${stat('dbw', x.dbw)}${stat('vrms', x.vrms)}${stat('vpp', x.vpp)}${stat('dbuv', x.dbuv)}</dl>
    <h3>${esc(x.ratio_heading)}</h3>
    <dl class="dy-stats">${stat('pr', x.pr)}${stat('vr', x.vr)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'resistor-color': x => {
      const digits = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
      const opts = list => list.map(c => [c, x.colors[c]]);
      return `<form id="rcc-form" class="dy-form" data-colors="${esc(JSON.stringify(x.colors))}">
    <h2>${esc(x.in_heading)}</h2>
    ${select('bands', x.bands, [['4', x.bands4], ['5', x.bands5]], '4')}
    ${select('d1', x.d1, opts(digits), 'brown')}
    ${select('d2', x.d2, opts(digits), 'black')}
    <div data-band3 hidden>${select('d3', x.d3, opts(digits), 'black')}</div>
    ${select('mul', x.mul, opts([...digits, 'gold', 'silver']), 'red')}
    ${select('tol', x.tol, opts(['brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'gold', 'silver']), 'gold')}
    ${field('target', x.target, 4700, 'min="0" step="any"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <svg id="rcc-body" class="resistor-art" viewBox="0 0 300 100" role="img" aria-label="${esc(x.art_label)}"></svg>
    <dl class="dy-stats">${stat('value', x.value)}${stat('tol', x.tol_out)}${stat('range', x.range)}</dl>
    <h3>${esc(x.rev_heading)}</h3>
    <dl class="dy-stats">${stat('code4', x.code4)}${stat('code5', x.code5)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`;
    },
    divider: x => `<form id="dv-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('vin', x.vin, 5, 'step="any"')}
    ${field('r1', x.r1, 10, 'min="0" step="any"')}
    ${field('r2', x.r2, 10, 'min="0" step="any"')}
    ${field('rl', x.rl, 0, 'min="0" step="any"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('vout', x.vout)}${stat('ratio', x.ratio)}${stat('vload', x.vload)}${stat('i', x.i)}${stat('p1', x.p1)}${stat('p2', x.p2)}${stat('rth', x.rth)}</dl>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    'led-resistor': x => `<form id="led-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('vs', x.vs, 5, 'step="any"')}
    ${field('vf', x.vf, 2, 'min="0" step="0.1"')}
    ${field('ma', x.ma, 10, 'min="0" step="any"')}
    ${field('n', x.n, 1, 'min="1" step="1"')}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('r', x.r)}${stat('re', x.re)}${stat('ie', x.ie)}${stat('pr', x.pr)}${stat('rating', x.rating)}${stat('pled', x.pled)}</dl>
    <p id="led-warn" class="muted" hidden>${esc(x.warn)}</p>
    <p class="muted">${esc(x.note)}</p>
  </section>`,
    rc: x => `<form id="rc-form" class="dy-form">
    <h2>${esc(x.in_heading)}</h2>
    ${field('r', x.r, 10, 'min="0" step="any"')}
    ${select('ru', x.unit, [[1, 'Ω'], [1e3, 'kΩ'], [1e6, 'MΩ']], 1e3)}
    ${field('c', x.c, 100, 'min="0" step="any"')}
    ${select('cu', x.unit, [[1e-12, 'pF'], [1e-9, 'nF'], [1e-6, 'µF']], 1e-9)}
    ${field('t', x.t, 1, 'min="0" step="any"')}
    ${select('tu', x.unit, [[1e-6, 'µs'], [1e-3, 'ms'], [1, 's']], 1e-3)}
  </form>
  <section class="dy-out" aria-live="polite">
    <h2>${esc(x.out_heading)}</h2>
    <dl class="dy-stats">${stat('tau', x.tau)}${stat('fc', x.fc)}${stat('t5', x.t5)}${stat('charge', x.charge)}${stat('discharge', x.discharge)}</dl>
    <svg id="rc-chart" class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(x.chart_label)}" data-labels="${esc(JSON.stringify({ x: x.x_label, y: x.y_label }))}"></svg>
    <p class="muted">${esc(x.chart_note)}</p>
  </section>`,
    'quiz-set': x => `<form id="qs-form" class="dy-form qs-form">
    <h2>${esc(x.in_heading)}</h2>
    <label class="dy-field qs-wide"><span>${esc(x.name_label)}</span><input name="t" type="text" maxlength="80" placeholder="${esc(x.name_ph)}"></label>
    ${select('n', x.count_label, [5, 10, 20, 30, 50].map(v => [v, String(v)]), 10)}
    <fieldset class="qs-topics qs-wide">
      <legend>${esc(x.topics_label)} <button type="button" class="btn btn-ghost btn-small" data-all>${esc(x.all)}</button> <button type="button" class="btn btn-ghost btn-small" data-none>${esc(x.none)}</button></legend>
      ${exams.flatMap(e => e.groups.map(gr => live.filter(c => c.exam === e.id && c.group === gr.id))).filter(l => l.length).map(l => `<div class="qs-group">${l.map(c => `<label><input type="checkbox" name="c" value="${c.id}"> ${esc(c.name)}</label>`).join('')}</div>`).join('')}
    </fieldset>
    <p class="qs-wide"><button type="submit" class="btn btn-primary">${esc(x.make)}</button></p>
  </form>
  <section class="dy-out" id="qs-out" hidden aria-live="polite">
    <h2>${esc(x.result_heading)}</h2>
    <p><input type="text" id="qs-url" class="qs-url" readonly aria-label="${esc(x.result_heading)}"></p>
    <p><button type="button" class="btn btn-primary btn-small" id="qs-copy" data-done="${esc(x.copied)}">${esc(x.copy)}</button> <a class="btn btn-ghost btn-small" id="qs-open" href="#" target="_blank" rel="noopener">${esc(x.open)}</a></p>
    <p class="muted">${esc(x.note)}</p>
    ${x.embed_heading ? `<h3>${esc(x.embed_heading)}</h3>
    <p><textarea id="qs-embed" class="qs-url" rows="4" readonly aria-label="${esc(x.embed_heading)}" data-site="${esc(siteName)}"></textarea></p>
    <p><button type="button" class="btn btn-ghost btn-small" id="qs-embed-copy" data-done="${esc(x.copied)}">${esc(x.embed_copy)}</button></p>
    <p class="muted">${esc(x.embed_note)}</p>` : ''}
  </section>`,
  };
  const toolPath = (tool, x) => `${x.path}tools/${tool.slug}/`;
  // ツールのページの下に出す関連ツール: 分野が重なる数の多い順に6つまで(足りなければ同じグループの順)
  const relatedTools = tool => toolsIn(code).filter(y => y !== tool)
    .map(y => ({ y, n: (y.cats ?? []).filter(c => (tool.cats ?? []).includes(c)).length + (y.cat === tool.cat ? 1 : 0) }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6).map(x => x.y);
  for (const tool of toolsIn(code)) {
    const x = tool.text[code];
    const tq = (tool.questions ?? []).map(id => qById.get(id)).filter(Boolean);
    const tt = (tool.terms ?? []).map(k => terms.find(y => y.key === k)).filter(Boolean);
    const tc = catOf(tool.cat);
    // 関連する図解と比較ページ(この言語で出せるものだけ)
    const tf = (tool.figures ?? []).map(id => figList.find(f => f.id === id)).filter(Boolean);
    const tcmp = (tool.compares ?? []).map(slug => cmp.find(e => e.slug === slug)).filter(Boolean);
    page({
      path: toolPath(tool, L),
      alt: Object.fromEntries(langs.filter(y => tool.text[y.code]).map(y => [y.code, toolPath(tool, y)])),
      fallback: y => `${y.path}tools/`,
      title: x.title,
      description: x.description,
      scripts: ['tool-share.js', `${tool.id}.js`, 'answer.js'],
      jsonld: [
        crumbs([t('breadcrumb_top'), home], [S.tools_title, `${home}tools/`], [x.h1, toolPath(tool, L)]),
        { '@context': 'https://schema.org', '@type': 'WebApplication', name: x.h1, description: x.description, url: abs(toolPath(tool, L)), inLanguage: L.htmlLang,
          applicationCategory: 'EducationalApplication', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
        { '@context': 'https://schema.org', '@type': 'FAQPage',
          mainEntity: x.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      ],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}tools/">${esc(S.tools_title)}</a></nav>
<h1>${esc(x.h1)}</h1>
<p class="lead">${esc(x.lead)}</p>
<div class="cmp-tools tool-actions" data-tool-id="${tool.id}"${tool.share === false ? '' : ' data-share'} hidden>
  <button type="button" class="btn btn-ghost" data-fav data-off="${esc(t('tool_fav_add'))}" data-on="${esc(t('tool_fav_on'))}" aria-pressed="false">${esc(t('tool_fav_add'))}</button>${tool.share === false ? '' : `
  <button type="button" class="btn btn-ghost" data-copy-result data-done="${esc(t('compare_copied'))}">${esc(t('tool_copy_result'))}</button>
  <button type="button" class="btn btn-ghost" data-share data-done="${esc(t('compare_link_copied'))}">${esc(t('tool_share'))}</button>`}
  <p class="muted tool-note">${esc(t(tool.share === false ? 'tool_note_local' : 'tool_note'))}</p>
</div>
<div class="dy">
  ${tool.form ? formBody(tool.form, x) : toolBody[tool.id](x)}
  <section class="dy-out" id="sweep" hidden>
    <h2>${esc(S.sweep_heading)}</h2>
    <div class="sweep-pick">
      <label class="dy-field"><span>${esc(S.sweep_x)}</span><select name="sweep-x"></select></label>
      <label class="dy-field"><span>${esc(S.sweep_y)}</span><select name="sweep-y"></select></label>
    </div>
    <svg class="sta-chart" viewBox="0 0 600 320" role="img" aria-label="${esc(S.sweep_heading)}"></svg>
    <p class="muted">${esc(S.sweep_note)}</p>
  </section>
</div>
${x.sections.map(sec => `<section class="term-about">
  <h2>${esc(sec.h)}</h2>
  <p>${linked(sec.p, tool.cat)}</p>
</section>`).join('\n')}
${tc && qs[tc.id]?.length ? `<p><a class="btn btn-primary" href="${home}quiz/?mode=category&amp;c=${tc.id}&amp;n=10" rel="nofollow">${esc(x.practice)}</a></p>` : ''}
${tq.length ? `<section>${tq.map(miniQ).join('')}</section>` : ''}
<section class="faq">
  <h2>${esc(t('compare_faq'))}</h2>${x.faq.map(f => `
  <h3>${esc(f.q)}</h3>
  <p>${esc(f.a)}</p>`).join('')}
</section>
<div data-ad="tool"></div>
${tt.length ? `<section>
  <h2>${esc(x.related)}</h2>
  <p class="term-chips">${tt.map(y => `<a class="chip" href="${home}term/${termSlug[y.key]}/">${esc(y.term)}</a>`).join(' ')}</p>
</section>` : ''}
${tf.length ? `<section>
  <h2>${esc(t('tool_rel_figures'))}</h2>
  <ul class="tool-figs">${tf.map(f => `<li><a href="${figHref(f.id)}"><img src="${base}img/${code}/${f.id}.svg" alt="" width="${f.size[0]}" height="${f.size[1]}" loading="lazy"><span>${esc(f.title)}</span></a></li>`).join('')}</ul>
</section>` : ''}
${cmpSection(t('tool_rel_compare'), tcmp)}
${toolsIn(code).length > 1 ? `<section>
  <h2>${esc(t('figure_tools'))}</h2>
  <div class="mode-grid compact">${relatedTools(tool).map(y => `<a class="mode-card" href="${home}tools/${y.slug}/"><strong>${esc(y.text[code].h1)}</strong><span>${esc(y.text[code].card)}</span></a>`).join('')}</div>
  <p><a class="btn btn-ghost" href="${home}tools/">${esc(S.tools_title)} →</a></p>
</section>` : ''}`,
    });
  }
  // 計算ツールを分野のグループ(基礎・デバイス・前工程…・システム)ごとにまとめる。グループの順は試験区分の定義の順
  const toolGroups = () => {
    const gs = [];
    for (const y of toolsIn(code)) {
      const c = catOf(y.cat);
      const name = c ? groupOf(c).name : '';
      const order = c ? (exams.find(e => e.id === c.exam)?.groups.findIndex(g => g.id === c.group) ?? 99) : 99;
      let g = gs.find(x => x.name === name);
      if (!g) gs.push(g = { name, order, items: [] });
      g.items.push(y);
    }
    return gs.sort((a, b) => a.order - b.order);
  };
  // 計算ツールの一覧 /tools/
  if (toolsIn(code).length) {
    page({
      path: `${L.path}tools/`,
      alt: Object.fromEntries(langs.filter(y => toolsIn(y.code).length).map(y => [y.code, `${y.path}tools/`])),
      title: S.tools_title,
      description: S.tools_lead,
      scripts: ['tools-list.js'],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a></nav>
<h1>${esc(S.tools_title)}</h1>
<p class="lead">${esc(S.tools_lead)}</p>
<section class="tool-mine" data-tool-mine hidden>
  <div data-list="fav" hidden><h2>${esc(t('tools_fav'))}</h2><div class="mode-grid compact"></div></div>
  <div data-list="recent" hidden><h2>${esc(t('tools_recent'))}</h2><div class="mode-grid compact"></div></div>
  <p class="muted">${esc(t('tools_local_note'))}</p>
</section>
${toolGroups().map(g => `<section>
  <h2>${esc(g.name)}</h2>
  <div class="mode-grid tool-all">${g.items.map(y => `<a class="mode-card" data-tool="${y.id}" href="${home}tools/${y.slug}/"><strong>${esc(y.text[code].h1)}</strong><span>${esc(y.text[code].card)}</span></a>`).join('')}</div>
</section>`).join('\n')}
<div data-ad="tools"></div>`,
    });
  }

  // 図ごとのページ /figures/{図ID}/: 静的な図と説明、その下に操作できる版、図を使う問題と関連する計算ツール
  for (const x of figList.filter(f => figPage(f.id))) {
    const ft = figLive[x.id].text[code];
    const ftools = toolsIn(code).filter(y => (y.figures ?? []).includes(x.id));
    const used = figUse[x.id] ?? [];
    const url = `${base}${figPagePath(x.id)}`;
    page({
      path: figPagePath(x.id),
      alt: Object.fromEntries(langs.filter(y => figLive[x.id].text[y.code] && localizeFigure(figs[x.id], y.code === defLang ? {} : readOpt(`data/i18n/${y.code}/figures.json`, {})[x.id], y.code === defLang)).map(y => [y.code, figPagePath(x.id, y)])),
      fallback: y => `${y.path}figures/`,
      title: ft.title,
      description: ft.description,
      scripts: ['fig-live.js'],
      jsonld: [
        crumbs([t('breadcrumb_top'), home], [S.figures_title, `${home}figures/`], [x.title, url]),
        { '@context': 'https://schema.org', '@type': 'Article', headline: ft.title, description: ft.description, inLanguage: L.htmlLang, image: abs(`${base}img/${code}/${x.id}.svg`),
          mainEntityOfPage: abs(url), author: { '@type': 'Organization', name: siteName }, publisher: { '@type': 'Organization', name: siteName } },
      ],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}figures/">${esc(S.figures_title)}</a></nav>
<h1>${esc(x.title)}</h1>
<figure class="fig">${x.svg}</figure>
${ft.about.map(para => `<p>${linked(para)}</p>`).join('\n')}
${figLiveHtml(x.id)}
<div data-ad="figures"></div>
${ftools.length ? `<section>
  <h2>${esc(t('figure_tools'))}</h2>
  <div class="mode-grid compact">${ftools.map(y => `<a class="mode-card" href="${home}tools/${y.slug}/"><strong>${esc(y.text[code].h1)}</strong><span>${esc(y.text[code].card)}</span></a>`).join('')}</div>
</section>` : ''}
${used.length ? `<section>
  <h2>${esc(t('figure_used_in'))}</h2>
  ${qLinks(used.slice(0, 10))}
</section>` : ''}
<p><a class="btn btn-ghost" href="${home}figures/">${esc(t('figure_back'))}</a></p>`,
    });
  }

  // 比較ページ /compare/ と /compare/{slug}/
  const cmpLangs = slug => langs.filter(x => x.code === defLang || readOpt(`data/i18n/${x.code}/compare.json`, {})[slug]);
  if (cmp.length) {
    const topCrumb = [t('breadcrumb_top'), home];
    const idxCrumb = [t('breadcrumb_compare'), `${home}compare/`];
    for (const e of cmp) {
      const c = catOf(e.cat);
      const quiz = (e.questions ?? []).map(id => qById.get(id)).filter(Boolean);
      const keyTerms = (e.terms ?? []).map(k => terms.find(x => x.key === k)).filter(Boolean);
      const faq = e.faq ?? [];
      const mini = quiz.filter(q => !q.code).slice(0, 3);
      const modified = lastmodPrev[`${L.path}compare/${e.slug}/`]?.date ?? new Date().toLocaleDateString('sv-SE');
      page({
        path: `${L.path}compare/${e.slug}/`,
        alt: Object.fromEntries(cmpLangs(e.slug).map(x => [x.code, `${x.path}compare/${e.slug}/`])),
        fallback: x => `${x.path}compare/`,
        title: e.title,
        description: e.description,
        scripts: ['compare.js', 'answer.js'],
        jsonld: [
          crumbs(topCrumb, idxCrumb, [e.title, cmpUrl(e)]),
          { '@context': 'https://schema.org', '@type': 'Article', headline: e.title, description: e.description, inLanguage: L.htmlLang, dateModified: modified,
            mainEntityOfPage: abs(cmpUrl(e)), author: { '@type': 'Organization', name: siteName }, publisher: { '@type': 'Organization', name: siteName } },
          ...(faq.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] : []),
        ],
        content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}compare/">${esc(t('breadcrumb_compare'))}</a></nav>
<article class="compare-page">
  <h1>${esc(e.title)}</h1>
  <p class="lead">${esc(e.lead)}</p>
  <div class="cmp-tools">
    <button type="button" class="btn btn-ghost" data-copy-table data-done="${esc(t('compare_copied'))}">${esc(t('compare_copy'))}</button>
    <button type="button" class="btn btn-ghost" data-share data-done="${esc(t('compare_link_copied'))}">${esc(t('compare_share'))}</button>
  </div>
  <div class="table-wrap">
    <table class="compare">
      <thead><tr><th scope="col">${esc(t('compare_aspect'))}</th>${e.items.map(x => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead>
      <tbody>${e.rows.map(([label, ...cells]) => `
        <tr><th scope="row">${esc(label)}</th>${cells.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  </div>
  <p class="muted compare-note">${esc(t('compare_note'))}</p>
</article>
<div data-ad="compare"></div>
<section>
  <h2>${esc(t('compare_when'))}</h2>
  <dl class="compare-when">${e.when.map(([k, v]) => `
    <dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
  </dl>
</section>
${faq.length ? `<section class="faq">
  <h2>${esc(t('compare_faq'))}</h2>${faq.map(([q, a]) => `
  <h3>${esc(q)}</h3>
  <p>${esc(a)}</p>`).join('')}
</section>` : ''}
${quiz.length ? `<section>
  <h2>${esc(t('compare_quiz'))}</h2>${mini.map(miniQ).join('')}
  ${quiz.length > mini.length ? qLinks(quiz.filter(q => !mini.includes(q))) : ''}
  <p><a class="btn btn-primary" href="${home}c/${c.id}/">${esc(t('compare_to_category', { name: c.name }))}</a></p>
</section>` : ''}
${keyTerms.length ? `<section>
  <h2>${esc(t('compare_terms'))}</h2>
  <dl class="glossary">${keyTerms.map(x => `
    <div class="term"><dt><a href="${home}term/${termSlug[x.key]}/">${esc(x.term)}</a></dt><dd>${esc(x.desc)}</dd></div>`).join('')}
  </dl>
</section>` : ''}
${cmpSection(t('compare_more'), relatedCmp(e))}`,
      });
    }
  }

  // ニュース用語の一覧 /news-terms/(新しい順)。各語のページは用語ページ(/term/{slug}/)に「なぜ今話題なのか」などを足したもの
  const ym = /^\d{4}-(?:\d{2}(?:-\d{2})?|Q[1-4])$/;
  for (const e of news) {
    const where = `data/news-terms.json「${e.term}」`;
    if (!glossary.some(g => g.term === e.term)) throw new Error(`${where}: 用語集にない語です(先に glossary.json に足してください)`);
    if (e.period?.length !== 2 || e.period.some(d => !ym.test(d))) throw new Error(`${where}: period は ["YYYY-MM", "YYYY-MM"] にしてください`);
    if (e.why.some(w => !ym.test(w.date) || !w.text)) throw new Error(`${where}(${code}): why の date(YYYY-MM-DD / YYYY-MM / YYYY-Qn)か本文がありません`);
    if (!e.short || !e.diff) throw new Error(`${where}(${code}): short と diff は必須です`);
    if (e.question && isDef && !qById.has(e.question)) throw new Error(`${where}: 存在しない問題 ${e.question}`);
    for (const k of e.terms ?? []) if (!glossary.some(g => g.term === k)) throw new Error(`${where}: 用語集にない語 ${k}`);
    for (const id of e.figures ?? []) if (!figs[id]) throw new Error(`${where}: 存在しない図 ${id}`);
  }
  const fmtDate = d => {
    const [y, m, day] = d.split('-');
    if (m.startsWith('Q')) return t('news_quarter', { y, q: m.slice(1) });
    return new Intl.DateTimeFormat(L.locale, { year: 'numeric', month: 'long', ...(day ? { day: 'numeric' } : {}), timeZone: 'UTC' })
      .format(new Date(Date.UTC(+y, +m - 1, +(day ?? 1))));
  };
  const newsPeriod = e => t('news_period', { from: fmtDate(e.period[0]), to: fmtDate(e.period[1]) });
  const newsName = e => e.label ?? terms.find(g => g.key === e.term).term;
  if (news.length) {
    const newsUrl = `${home}news-terms/`;
    page({
      path: `${L.path}news-terms/`,
      alt: Object.fromEntries(langs.filter(x => x.code === defLang || Object.keys(readOpt(`data/i18n/${x.code}/news-terms.json`, {})).length).map(x => [x.code, `${x.path}news-terms/`])),
      title: S.news_title,
      description: t('news_description', { terms: news.slice(0, 5).map(newsName).join(', ') }),
      jsonld: [
        crumbs([t('breadcrumb_top'), home], [S.nav_glossary, `${home}glossary/`], [S.news_title, newsUrl]),
        { '@context': 'https://schema.org', '@type': 'ItemList', name: S.news_title,
          itemListElement: news.map((e, i) => ({ '@type': 'ListItem', position: i + 1, name: newsName(e), url: abs(`${home}term/${termSlug[e.term]}/`) })) },
      ],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}glossary/">${esc(S.nav_glossary)}</a></nav>
<h1>${esc(S.news_title)}</h1>
<p class="lead">${esc(S.news_lead)}</p>
<ul class="cmp-list news-list">${news.map(e => `
  <li><a class="cmp-card" href="${home}term/${termSlug[e.term]}/"><strong>${esc(newsName(e))}</strong><span class="news-period">${esc(newsPeriod(e))}</span><span>${esc(e.short)}</span></a></li>`).join('')}
</ul>
<p class="muted">${esc(S.news_note)}</p>
<div data-ad="glossary"></div>
<p><a class="btn btn-ghost" href="${home}glossary/">${esc(t('term_to_glossary'))}</a></p>`,
    });
  }

  // 用語ページ /term/{slug}/ : 定義、その用語が出てくる問題(問題文・解説の自動リンクから逆引き)、関連する用語
  const termIds = (text, cat) => linkTerms(text, matcher, skipIn(cat)).filter(x => typeof x !== 'string').map(x => x.id);
  const termQs = new Map(terms.map(g => [g.key, []]));
  for (const c of cats) for (const q of qs[c.id]) {
    const inQ = new Set(termIds(q.question, c.id));
    const ids = new Set([...inQ, ...termIds(q.explanation, c.id)]);
    for (const id of ids) termQs.get(id).push({ ...q, cat: c.id, ids, inQ: inQ.has(id) });
  }
  for (const g of terms) {
    // 問題文に用語が出てくる問題を先に並べる
    const list = termQs.get(g.key).sort((a, b) => b.inQ - a.inQ);
    const fig = list.find(q => q.inQ && q.figureSvg);
    // 解説からの抜き出し: 用語を含む最初の文(最大3問ぶん)
    const quotes = list.map(q => ({ q, s: q.explanation.split(/(?<=。)|(?<=[.!?])\s+/).map(x => x.trim()).find(x => termIds(x).includes(g.key)) }))
      .filter(x => x.s).slice(0, 5);
    // 関連する用語: 同じ問題によく一緒に出てくる語 → 同じ分野の語
    const co = new Map();
    for (const q of list) for (const id of q.ids) if (id !== g.key) co.set(id, (co.get(id) || 0) + 1);
    const rel = [...[...co].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      ...terms.filter(x => x.cat === g.cat && x.key !== g.key).map(x => x.key)];
    const related = [...new Set(rel)].slice(0, 10).map(id => terms.find(x => x.key === id));
    const c = catOf(g.cat);
    // どの分野の何問に出てくるか(本文の要約)と、その場で解ける練習問題
    const byCat = new Map();
    for (const q of list) byCat.set(q.cat, (byCat.get(q.cat) || 0) + 1);
    const topCats = [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => catOf(id).name);
    const termSummary = list.length ? `<p class="muted term-summary">${esc(t('term_summary', { term: g.term, n: list.length, k: byCat.size, topics: topCats.join(', ') }))}</p>` : '';
    const pickable = list.filter(q => !q.code);
    // ニュース用語は、確認問題として指定した1問だけを出す
    const nw = newsOf(g.key);
    const nwQ = nw?.question && qById.get(nw.question);
    const pick = nwQ ? [nwQ] : (pickable.some(q => q.inQ) ? pickable.filter(q => q.inQ) : pickable).slice(0, 2);
    const practiceHtml = pick.length ? `<section>
  <h2>${esc(t('term_practice', { term: g.term }))}</h2>${pick.map(q => `
  <article class="q-mini"${qData(q)}>
    <h3><a href="${base}${qUrl(q.cat, q.id)}">${esc(q.question)}</a></h3>
    <ol class="q-choices">${q.choices.map((ch, k) => `<li><span class="choice-mark">${mark(k)}</span><span class="choice-text">${esc(ch)}</span></li>`).join('')}</ol>
    <details class="q-answer"><summary>${esc(t('answer_toggle'))}</summary><p class="verdict ok">${esc(t('answer_is', { mark: mark(q.answer), text: q.choices[q.answer] }))}</p><p class="explanation">${linked(q.explanation, q.cat)}</p></details>
  </article>`).join('')}
</section>` : '';
    // 詳しい解説(about: 見出しと段落)とよくある質問(faq)。用語集の訳にあるときだけ出す(今は表示回数の多い英語の用語)
    // 段落の中の用語は、このページ自身の語を除いて用語ページにリンクする。用語の分野で別の意味になる語(noLinkIn/linkOnlyIn)は除く
    const linkedOther = text => linkTerms(text, matcher, skipIn(g.cat)).map(p => (typeof p === 'string' ? esc(p)
      : p.id === g.key ? esc(p.text) : `<a class="term-link" href="${home}term/${termSlug[p.id]}/">${esc(p.text)}</a>`)).join('');
    const about = g.about ?? [];
    const faq = g.faq ?? [];
    const aboutHtml = about.map(s => `<section class="term-about">
  <h2>${esc(s.h)}</h2>
  <p>${linkedOther(s.p)}</p>
</section>`).join('\n');
    const faqHtml = faq.length ? `<section class="faq">
  <h2>${esc(t('compare_faq'))}</h2>${faq.map(x => `
  <h3>${esc(x.q)}</h3>
  <p>${esc(x.a)}</p>`).join('')}
</section>` : '';
    // ニュース用語: 「ひとことで言うと」「なぜ今話題なのか(日付つき)」を解説の前に、「既存技術との違い」を解説の後に置く
    const termCmp = cmp.filter(e => (e.terms ?? []).includes(g.key) || termIds([e.title, ...(e.items ?? [])].join(' ')).includes(g.key));
    const nwFigs = (nw?.figures ?? []).filter(id => id !== fig?.figureId).map(id => ({ id, svg: localizeFigure(figs[id], figT[id], isDef) })).filter(x => x.svg);
    const newsHtml = nw ? `<section class="news-term">
  <p class="news-badge"><a href="${home}news-terms/">${esc(S.news_title)}</a> · ${esc(t('news_period_label'))}: ${esc(newsPeriod(nw))}</p>
  <h2>${esc(t('news_short'))}</h2>
  <p>${linkedOther(nw.short)}</p>
  <h2>${esc(t('news_why'))}</h2>
  <ul class="news-why">${nw.why.map(w => `<li><time datetime="${/Q/.test(w.date) ? w.date.slice(0, 4) : w.date}">${esc(fmtDate(w.date))}</time> ${esc(w.text)}</li>`).join('')}</ul>
  ${nw.background ? `<p>${linkedOther(nw.background)}</p>` : ''}
  <details class="news-sources"><summary>${esc(t('news_sources'))}</summary><ul>${nw.sources.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>${x.date ? ` (${esc(fmtDate(x.date))})` : ''}</li>`).join('')}</ul></details>
</section>
${nwFigs.map(x => figureHtml(x.svg, x.id)).join('\n')}` : '';
    const diffHtml = nw ? `<section>
  <h2>${esc(t('news_diff'))}</h2>
  <p>${linkedOther(nw.diff)}</p>
  ${termCmp.length ? cmpCards(termCmp) : ''}
</section>` : '';
    if (nw) related.unshift(...(nw.terms ?? []).map(k => terms.find(x => x.key === k)).filter(x => x && !related.includes(x)));
    const termUrl = `${home}term/${termSlug[g.key]}/`;
    // 英語名を添える言語(繁体字など。英語の用語名に「中文」「是什麼」を付けて調べる人が多い)では、用語名に英語名が含まれていなければ添える
    // 用語名にもうカッコ(略語や別名)があるときは、カッコが重なるので添えない
    const en = !isDef && code !== 'en' && S.term_title_en && enLabel(g.key);
    const withEn = en && !g.term.toLowerCase().includes(en.toLowerCase()) && !/[()（）]/.test(g.term);
    page({
      path: `${L.path}term/${termSlug[g.key]}/`,
      alt: Object.fromEntries(termLangs(g.key).map(x => [x.code, `${x.path}term/${termSlug[g.key]}/`])),
      title: g.title ?? (withEn ? t('term_title_en', { term: g.term, en }) : t('term_title', { term: g.term })),
      description: g.description ?? termDescription(g.desc, list.length),
      scripts: ['answer.js'],
      // 問題に一度も出てこず、詳しい解説(about)もない用語のページは、中身が薄いので検索に出さない(ニュース用語は出す)。
      // 解説のある用語は、その言語の問題に出てこなくても検索に出す(Search Console で、解説を書いたページが noindex になっていた: 2026-10-22)
      noindex: !list.length && !nw && !g.about?.length,
      jsonld: [
        crumbs([t('breadcrumb_top'), home], [S.nav_glossary, `${home}glossary/`], [g.term, termUrl]),
        { '@context': 'https://schema.org', '@type': 'DefinedTerm', name: g.term, description: g.desc, url: abs(termUrl), inLanguage: L.htmlLang,
          inDefinedTermSet: { '@type': 'DefinedTermSet', name: S.nav_glossary, url: abs(`${home}glossary/`) } },
        ...(faq.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage',
          mainEntity: faq.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) }] : []),
        ...(nw ? [{ '@context': 'https://schema.org', '@type': 'Article', headline: t('term_title', { term: g.term }), description: nw.short, inLanguage: L.htmlLang,
          datePublished: nw.added, dateModified: lastmodPrev[`${L.path}term/${termSlug[g.key]}/`]?.date ?? new Date().toLocaleDateString('sv-SE'),
          mainEntityOfPage: abs(termUrl), author: { '@type': 'Organization', name: siteName }, publisher: { '@type': 'Organization', name: siteName } }] : []),
      ],
      content: `<nav class="breadcrumb"><a href="${home}">${esc(t('breadcrumb_top'))}</a> <span>›</span> <a href="${home}glossary/">${esc(S.nav_glossary)}</a>${c ? ` <span>›</span> <a href="${home}glossary/#cat-${c.id}">${esc(c.name)}</a>` : ''}</nav>
<article class="term-page">
  <h1>${esc(t('term_heading', { term: g.term }))}</h1>
  ${g.reading ? `<p class="muted">${esc(g.reading)}</p>` : ''}
  <p class="lead">${esc(g.desc)}</p>
  ${learnByTerm.has(g.key) ? `<p class="learn-link">${esc(LT.termLink)}: <a href="${home}learn/${learnByTerm.get(g.key).slug}/" data-track="term_learn">${esc(learnByTerm.get(g.key).title)}</a></p>` : ''}
  ${isDef ? '' : `<p class="muted">${esc(t('term_ja_name'))}: <span lang="ja">${esc(g.key)}</span></p>`}
  ${termSummary}
  ${fig ? figureHtml(fig.figureSvg, fig.figureId) : ''}
  ${c ? `<p>${esc(t('term_category'))}: <a href="${home}c/${c.id}/">${esc(c.name)}</a></p>` : ''}
</article>
${newsHtml ? `${newsHtml}\n` : ''}${aboutHtml}
${diffHtml ? `${diffHtml}\n` : ''}${practiceHtml}
${faqHtml}
${quotes.length ? `<section>
  <h2>${esc(t('term_quotes', { term: g.term }))}</h2>
  <ul class="term-quotes">${quotes.map(({ q, s }) => `<li><p>${esc(s)}</p><a href="${base}${qUrl(q.cat, q.id)}">${esc(short(q.question, 60))}</a></li>`).join('')}</ul>
</section>` : ''}
${list.length ? `<section>
  <h2>${esc(t('term_questions', { term: g.term, n: list.length }))}</h2>
  ${qLinks(list.slice(0, 15))}
</section>` : ''}
${c ? bookSection(c) : ''}
<div data-ad="term"></div>
${nw ? '' : cmpSection(t('compare_in_term'), termCmp)}
${toolsIn(code).some(y => (y.terms ?? []).includes(g.key)) ? `<section>
  <h2>${esc(S.tools_title)}</h2>
  <div class="mode-grid compact">${toolsIn(code).filter(y => (y.terms ?? []).includes(g.key)).map(y => `<a class="mode-card" href="${home}tools/${y.slug}/"><strong>${esc(y.text[code].h1)}</strong><span>${esc(y.text[code].card)}</span></a>`).join('')}</div>
</section>` : ''}
${related.length ? `<section>
  <h2>${esc(t('term_related'))}</h2>
  <p class="term-chips">${related.slice(0, 10).map(x => `<a class="chip" href="${home}term/${termSlug[x.key]}/">${esc(x.term)}</a>`).join(' ')}</p>
</section>` : ''}
${nw ? `<p><a class="btn btn-ghost" href="${home}news-terms/">${esc(t('news_to_list'))}</a></p>\n` : ''}<p><a class="btn btn-ghost" href="${home}glossary/">${esc(t('term_to_glossary'))}</a></p>`,
    });
  }
}

// ---- sitemap / robots / その他 ----
// data/lastmod.json に「ページ → 本文のハッシュと更新日」を記録し、本文が変わったページだけ更新日(lastmod)を今日にする
const lastmodFile = path.join(root, 'data/lastmod.json');
const lastmodOld = fs.existsSync(lastmodFile) ? JSON.parse(fs.readFileSync(lastmodFile, 'utf8')) : {};
const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD(端末の日付)
const pageKey = url => url.slice(baseUrl.length) || '/';
const lastmod = Object.fromEntries(sitemap.map(({ url, hash }) =>
  [pageKey(url), lastmodOld[pageKey(url)]?.hash === hash ? lastmodOld[pageKey(url)] : { hash, date: today }]));
fs.writeFileSync(lastmodFile, '{\n' + Object.entries(lastmod).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
// サイトマップは言語×ページの種類ごとのファイル(sitemaps/{言語}-{種類}.xml)に分け、/sitemap.xml をその目次(サイトマップインデックス)にする。
// Search Console ではサイトマップごとに登録数が見えるので、どの種類のページが登録されにくいかが分かる。
// 1ファイルは5万URLまでなので、SITEMAP_MAX を超えたら sitemaps/{言語}-{種類}-2.xml … と続ける。
// /sitemap.xml の場所は変えないので、Search Console と robots.txt はそのままでよい
const SITEMAP_MAX = 40000;
const langOfUrl = url => [...langs].sort((a, b) => b.path.length - a.path.length).find(x => pageKey(url).startsWith(x.path)).code; // 既定言語(path が空)は最後に当たる
const SITEMAP_TYPES = ['term', 'compare', 'q', 'learn', 'tools']; // これ以外(トップ・分野・図解集など)は other にまとめる
const typeOfUrl = url => {
  const L = langs.find(x => x.code === langOfUrl(url));
  const first = pageKey(url).slice(L.path.length).split('/')[0];
  return SITEMAP_TYPES.includes(first) ? first : 'other';
};
const sitemapFiles = [];
for (const L of langs) for (const type of [...SITEMAP_TYPES, 'other']) {
  const list = sitemap.filter(({ url }) => langOfUrl(url) === L.code && typeOfUrl(url) === type);
  for (let i = 0; i < list.length; i += SITEMAP_MAX) {
    const part = list.slice(i, i + SITEMAP_MAX);
    const name = `sitemaps/${L.code}-${type}${i ? `-${i / SITEMAP_MAX + 1}` : ''}.xml`;
    write(name, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${part.map(({ url }) => `  <url><loc>${url}</loc><lastmod>${lastmod[pageKey(url)].date}</lastmod></url>`).join('\n')}
</urlset>
`);
    sitemapFiles.push({ name, date: part.map(({ url }) => lastmod[pageKey(url)].date).sort().at(-1) });
  }
}
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapFiles.map(f => `  <sitemap><loc>${baseUrl}${f.name}</loc><lastmod>${f.date}</lastmod></sitemap>`).join('\n')}
</sitemapindex>
`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}sitemap.xml\n`);
write('.nojekyll', '');
if (config.cname) write('CNAME', config.cname + '\n');
// AdSense の販売者情報(adsenseClient が ca-pub-XXXX のとき pub-XXXX を書く)
if (config.adsenseClient) write('ads.txt', `google.com, ${config.adsenseClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);

// ---- PWA: アイコンと Service Worker ----
for (const size of [192, 512]) write(`icon-${size}.png`, iconPng(size, config.icon));
// 最初に保存しておくファイル: 各言語のトップ・クイズ・成績のページと問題データ、JS・CSS・アイコン
const files = dir => fs.readdirSync(path.join(out, dir), { recursive: true }).map(f => `${dir}/${f.replaceAll('\\', '/')}`)
  .filter(f => fs.statSync(path.join(out, f)).isFile());
// 最初の訪問で保存するのは画面の骨組みだけ。問題データなど(data/{言語}/)は、開いたページの言語の分だけを
// ページからの知らせ(postMessage)を受けて保存する(7言語すべてだと約30 MB になり、通信量の無駄になるため)
const precache = [
  ...langs.flatMap(L => [L.path, `${L.path}quiz/`, `${L.path}stats/`, `${L.path}manifest.json`]),
  ...files('js'), ...files('css'), 'icon-192.png', 'icon-512.png',
];
const langData = Object.fromEntries(langs.map(L => [L.code, files(`data/${L.code}`).filter(f => !f.endsWith('/search.json'))]));
// 中身が変わったら版も変わり、古いキャッシュは消える
const hash = crypto.createHash('sha1');
for (const f of [...precache, ...Object.values(langData).flat()]) hash.update(fs.readFileSync(path.join(out, f.endsWith('/') || !f ? `${f}index.html` : f)));
write('sw.js', fill(read('src/templates/sw.js'), {
  version: hash.digest('hex').slice(0, 10),
  base: JSON.stringify(base),
  homes: JSON.stringify(langs.map(L => base + L.path).sort((a, b) => b.length - a.length)),
  precache: JSON.stringify(precache.map(f => base + f), null, 2),
  langData: JSON.stringify(Object.fromEntries(Object.entries(langData).map(([k, v]) => [k, v.map(f => base + f)]))),
}));

const total = Object.values(questions).reduce((s, x) => s + x.length, 0);
console.log(`build完了: ${langs.length}言語, ${sitemap.length} ページ（sitemap掲載）, 問題 ${total} 問 → docs/`);
