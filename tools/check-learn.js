// やさしい解説(src/learn/{言語}/*.html)の検査。記事の型(research/2026-10-23-articles-plan.md の5章)と、読みやすさの目安を見る。
// 誤り: 情報(先頭の JSON)の不足、存在しない分野・用語・図、記事の型の欠け、スクリプトや色の直書き、
// 本文からクイズ・分野ページ・学習コースへのリンク(記事は読み物にする。クイズへの案内はビルドが記事の後に1行だけ出す: 運営者の指示 2026-10-23)
// 注意: 長すぎる文、題・説明文の長さ、見直しの時期を過ぎた記事
// 使い方: node tools/check-learn.js [--strict](--strict では注意も失敗にする)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const strict = process.argv.includes('--strict');
const errors = [], warnings = [];

const learn = fs.existsSync(path.join(root, 'data/learn.json')) ? readJSON('data/learn.json') : { series: [] };
const cats = new Set(readJSON('data/categories.json').map(c => c.id));
const glossary = readJSON('data/glossary.json');
const termOk = k => glossary.some(g => g.term === k || (g.aliases ?? []).includes(k));
const figs = new Set(fs.readdirSync(path.join(root, 'data/figures')).map(f => f.replace(/\.svg$/, '')));
const today = new Date().toISOString().slice(0, 7);

const dir = path.join(root, 'src/learn');
const langs = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
let count = 0;
for (const lang of langs) {
  for (const file of fs.readdirSync(path.join(dir, lang)).filter(f => f.endsWith('.html'))) {
    count++;
    const where = `src/learn/${lang}/${file}`;
    const err = m => errors.push(`${where}: ${m}`), warn = m => warnings.push(`${where}: ${m}`);
    const src = fs.readFileSync(path.join(dir, lang, file), 'utf8');
    const m = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->/);
    if (!m) { err('先頭に JSON のコメントがありません'); continue; }
    let a;
    try { a = JSON.parse(m[1]); } catch (e) { err(`JSON が読めません: ${e.message}`); continue; }
    const body = src.slice(m[0].length);
    for (const k of ['title', 'description', 'series', 'order', 'updated', 'review', 'cats', 'sources']) if (a[k] == null) err(`${k} がありません`);
    if (a.series && !learn.series.some(s => s.id === a.series)) err(`data/learn.json にないシリーズ ${a.series}`);
    for (const id of a.cats ?? []) if (!cats.has(id)) err(`存在しない分野 ${id}`);
    for (const k of a.terms ?? []) if (!glossary.some(g => g.term === k)) err(`用語集にない語(terms) ${k}`);
    if (a.check) err('check(理解度チェックの問題)は使わなくなりました。消してください');
    if (/\{\{home\}\}(c|quiz|course)\//.test(body)) err('本文にクイズ・分野ページ・学習コースへのリンクがあります');
    if (!(a.sources ?? []).length) err('参考にした資料(sources)がありません');
    for (const x of a.sources ?? []) if (!x.title || !/^https:\/\//.test(x.url ?? '')) err(`資料の書き方: ${JSON.stringify(x)}`);
    if (a.review && a.review < today) warn(`見直しの時期(${a.review})を過ぎています`);
    // 題と説明文の長さ(検索結果で切れない目安)
    const cjk = ['ja', 'zh-hant', 'ko'].includes(lang);
    if (a.title && a.title.length > (cjk ? 40 : 80)) warn(`題が長い(${a.title.length}字)`);
    if (a.description && (a.description.length < (cjk ? 50 : 100) || a.description.length > (cjk ? 140 : 180))) warn(`説明文の長さ(${a.description.length}字)`);
    // 記事の型
    for (const [re, name] of [[/<p class="lead">/, '冒頭の答え(p.lead)'], [/class="learn-box"/, '「この記事でわかること」(learn-box)'], [/class="myth"/, 'よくある誤解(myth)']]) if (!re.test(body)) err(`${name}がありません`);
    const analogies = (body.match(/class="analogy"/g) ?? []).length, limits = (body.match(/class="analogy-limit"/g) ?? []).length;
    if (analogies !== limits) err(`たとえ話 ${analogies} 個に対して、当てはまらない点が ${limits} 個です`);
    if (/<script|\son\w+=|\sstyle=/i.test(body)) err('スクリプト・イベント属性・style 属性は使えません');
    for (const svg of body.match(/<svg[\s\S]*?<\/svg>/g) ?? []) {
      if (!/<title>[^<]+<\/title>/.test(svg)) err('SVG に <title> がありません');
      if (/(fill|stroke)="#|(fill|stroke):\s*#|rgb\(/i.test(svg)) err('SVG に色を直接書いています(サイトのクラスを使ってください)');
    }
    for (const [, id] of body.matchAll(/\{\{fig:([\w-]+)\}\}/g)) if (!figs.has(id)) err(`存在しない図 ${id}`);
    for (const [, k] of body.matchAll(/\{\{term:([^}|]+)(?:\|[^}]+)?\}\}/g)) if (!termOk(k)) err(`用語集にない語 ${k}`);
    // 読みやすさ: 長すぎる文(図と表を除く本文)
    const text = body.replace(/<svg[\s\S]*?<\/svg>|<table[\s\S]*?<\/table>/g, '').replace(/\{\{term:[^}|]+\|([^}]+)\}\}/g, '$1').replace(/\{\{term:([^}]+)\}\}/g, '$1')
      .replace(/<[^>]+>/g, '\n').replace(/\{\{[^}]*\}\}/g, '');
    const sentences = cjk ? text.split(/(?<=[。？！?!])|\n/) : text.split(/(?<=[.?!])\s+|\n/);
    const long = sentences.map(s => s.trim()).filter(s => (cjk ? s.length > 90 : s.split(/\s+/).length > 40));
    if (long.length) warn(`長い文 ${long.length} 個: 「${long[0].slice(0, 30)}…」など`);
  }
}
for (const w of warnings) console.log(`注意: ${w}`);
for (const e of errors) console.error(`誤り: ${e}`);
if (errors.length || (strict && warnings.length)) process.exit(1);
console.log(`OK: やさしい解説 ${count} 本を検査${warnings.length ? `、注意 ${warnings.length} 件` : ''}`);
