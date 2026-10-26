// 問題データの検査。単体実行: node tools/validate.js
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { figures, figureLabels, needsTr } from './figures.js';

const root = path.resolve(import.meta.dirname, '..');
const readJSON = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

export function validate() {
  const errors = [];
  let total = 0, unreviewed = 0;
  const exams = readJSON('data/exams.json');
  const categories = readJSON('data/categories.json');

  // choiceNotes: 選択肢と同じ数の配列。値は文字列(補足がない選択肢は "" か null)
  const checkNotes = (notes, choices, where) => {
    if (notes === undefined) return;
    if (!Array.isArray(notes) || !Array.isArray(choices) || notes.length !== choices.length
      || notes.some(x => x != null && typeof x !== 'string')) errors.push(`${where}: choiceNotes は choices と同じ数の文字列の配列にしてください`);
  };

  const figs = figures();

  const catIds = new Set();
  for (const c of categories) {
    for (const k of ['id', 'exam', 'group', 'name', 'description', 'intro']) {
      if (!c[k]) errors.push(`categories.json: ${c.id ?? '?'} に ${k} がありません`);
    }
    if (catIds.has(c.id)) errors.push(`categories.json: 分野IDが重複しています: ${c.id}`);
    catIds.add(c.id);
    const exam = exams.find(e => e.id === c.exam);
    if (!exam) errors.push(`categories.json: ${c.id} の exam "${c.exam}" が exams.json にありません`);
    else if (!exam.groups.some(g => g.id === c.group)) errors.push(`categories.json: ${c.id} の group "${c.group}" が exams.json にありません`);
  }

  // 学習コース: 分野IDが存在するか
  if (fs.existsSync(path.join(root, 'data/courses.json'))) {
    for (const co of readJSON('data/courses.json')) {
      for (const id of co.steps) if (!catIds.has(id)) errors.push(`courses.json: ${co.id} の分野 "${id}" が categories.json にありません`);
    }
  }

  const qIds = new Map();
  const qTexts = new Map();
  const dir = path.join(root, 'data/questions');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const cat = f.slice(0, -5);
    if (!catIds.has(cat)) errors.push(`${f}: 分野 "${cat}" が categories.json にありません`);
    let qs;
    try { qs = readJSON(`data/questions/${f}`); } catch (e) { errors.push(`${f}: JSONの書式エラー ${e.message}`); continue; }

    qs.forEach((q, n) => {
      const where = `${f} [${n}] ${q.id ?? ''}`;
      for (const k of ['id', 'question', 'explanation', 'source']) {
        if (typeof q[k] !== 'string' || !q[k]) errors.push(`${where}: ${k} がありません`);
      }
      if (typeof q.reviewed !== 'boolean') errors.push(`${where}: reviewed は true / false で指定してください`);
      if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`${where}: choices は2つ以上必要です`);
      else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
        errors.push(`${where}: answer は 0〜${q.choices.length - 1} の整数にしてください（現在: ${q.answer}）`);
      }
      if (qIds.has(q.id)) errors.push(`${where}: IDが ${qIds.get(q.id)} と重複しています`);
      else qIds.set(q.id, f);
      if (qTexts.has(q.question)) errors.push(`${where}: 問題文が ${qTexts.get(q.question)} と同じです`);
      else qTexts.set(q.question, q.id);
      if (Array.isArray(q.choices) && new Set(q.choices).size !== q.choices.length) errors.push(`${where}: 同じ選択肢があります`);
      // 任意の項目(あるときだけ検査)
      if ('level' in q && ![1, 2, 3].includes(q.level)) errors.push(`${where}: level は 1〜3 の整数にしてください`);
      checkNotes(q.choiceNotes, q.choices, where);
      if ('figure' in q && !figs[q.figure]) errors.push(`${where}: 図 "${q.figure}" が data/figures/${q.figure}.svg にありません`);
      // コード: 10行以内の文字列。codeLang は表示用の言語名(C / RISC-V / Verilog)
      if ('code' in q && (typeof q.code !== 'string' || !q.code)) errors.push(`${where}: code は文字列にしてください`);
      else if ('code' in q && q.code.split('\n').length > 10) errors.push(`${where}: code は10行以内にしてください`);
      if ('codeLang' in q && !['C', 'RISC-V', 'Verilog'].includes(q.codeLang)) errors.push(`${where}: codeLang は C / RISC-V / Verilog のどれかにしてください`);
      if ('tags' in q && (!Array.isArray(q.tags) || q.tags.some(x => typeof x !== 'string' || !x))) errors.push(`${where}: tags は文字列の配列にしてください`);
      total++;
      if (!q.reviewed) unreviewed++;
    });
  }
  // ---- 翻訳(data/i18n/{言語}/、src/i18n/{言語}.json、src/pages/{言語}/) ----
  const warnings = [];
  const translations = []; // 言語ごとの翻訳欠落数(1言語1行)
  const config = readJSON('config.json');
  const allQ = new Map();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try { for (const q of readJSON(`data/questions/${f}`)) allQ.set(q.id, q); } catch {}
  }
  const glossaryTerms = new Set(readJSON('data/glossary.json').map(g => g.term));
  const opt = p => (fs.existsSync(path.join(root, p)) ? readJSON(p) : {});
  const pages = code => (fs.existsSync(path.join(root, 'src/pages', code)) ? fs.readdirSync(path.join(root, 'src/pages', code)).filter(f => f.endsWith('.html')) : []);
  const def = config.languages[0].code;
  const uiKeys = Object.keys(readJSON(`src/i18n/${def}.json`));
  for (const { code } of config.languages.slice(1)) {
    const base = `data/i18n/${code}`;
    const catT = opt(`${base}/categories.json`);
    for (const id of Object.keys(catT)) if (!catIds.has(id)) errors.push(`${base}/categories.json: 分野 "${id}" がありません`);
    const gloT = opt(`${base}/glossary.json`);
    for (const term of Object.keys(gloT)) {
      if (!glossaryTerms.has(term)) errors.push(`${base}/glossary.json: 用語 "${term}" が glossary.json にありません`);
      // 用語ページの詳しい解説(about: [{h, p}])とよくある質問(faq: [{q, a}])は、見出しと本文がそろっていること
      const { about = [], faq = [] } = gloT[term];
      if (about.some(s => !s.h?.trim() || !s.p?.trim())) errors.push(`${base}/glossary.json: "${term}" の about に見出しか本文が空のものがあります`);
      if (faq.some(x => !x.q?.trim() || !x.a?.trim())) errors.push(`${base}/glossary.json: "${term}" の faq に質問か答えが空のものがあります`);
    }
    const figT = opt(`${base}/figures.json`);
    for (const [id, map] of Object.entries(figT)) {
      if (!figs[id]) { errors.push(`${base}/figures.json: 図 "${id}" がありません`); continue; }
      const labels = figureLabels(figs[id]);
      for (const k of Object.keys(map)) if (!labels.includes(k)) errors.push(`${base}/figures.json: 図 "${id}" に文字 "${k}" がありません`);
    }
    const exT = opt(`${base}/exams.json`);
    const ui = opt(`src/i18n/${code}.json`);
    const missing = {
      'UI文言': uiKeys.filter(k => !(k in ui)).length,
      'ページ': pages(def).filter(f => !pages(code).includes(f)).length,
      '試験・区分': exams.flatMap(e => [!exT[e.id]?.name, ...e.groups.map(g => !exT[e.id]?.groups?.[g.id])]).filter(Boolean).length,
      '分野': [...catIds].filter(id => !catT[id]).length,
      '用語': [...glossaryTerms].filter(term => !gloT[term]).length,
      '図': Object.entries(figs).filter(([id, svg]) => figureLabels(svg).some(x => needsTr(x) && figT[id]?.[x] == null)).length,
    };
    let done = 0;
    const qdir = path.join(root, base, 'questions');
    for (const f of fs.existsSync(qdir) ? fs.readdirSync(qdir).filter(f => f.endsWith('.json')) : []) {
      let tq;
      try { tq = readJSON(`${base}/questions/${f}`); } catch (e) { errors.push(`${base}/questions/${f}: JSONの書式エラー ${e.message}`); continue; }
      for (const [id, q] of Object.entries(tq)) {
        const where = `${base}/questions/${f} ${id}`;
        const orig = allQ.get(id);
        if (!orig) { errors.push(`${where}: 元の問題がありません`); continue; }
        for (const k of ['question', 'explanation']) if (typeof q[k] !== 'string' || !q[k]) errors.push(`${where}: ${k} がありません`);
        if (!Array.isArray(q.choices) || q.choices.length !== orig.choices.length) errors.push(`${where}: choices の数が元の問題と違います`);
        checkNotes(q.choiceNotes, orig.choices, where);
        done++;
      }
    }
    missing['問題'] = total - done;
    translations.push(`[${code}] 翻訳の欠落: ${Object.entries(missing).map(([k, n]) => `${k} ${n}`).join(' / ')}`
      + (missing['問題'] ? '(訳のない問題はこの言語では出題しない)' : ''));
  }
  return { errors, warnings, translations, total, unreviewed };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errors, warnings, translations, total, unreviewed } = validate();
  translations.forEach(x => console.log(x));
  warnings.forEach(w => console.log(`注意: ${w}`));
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`\nNG: ${errors.length} 件のエラー`);
    process.exit(1);
  }
  console.log(`OK: 問題 ${total} 問（未確認 ${unreviewed} 問）`);
}
