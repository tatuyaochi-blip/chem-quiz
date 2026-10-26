// 翻訳の古さの検出。日本語の問題(問題文・選択肢・解説)を直したあと、
// まだ訳し直していない言語と問題IDを一覧にする。
// 仕組み: 訳した時点の日本語のハッシュを data/i18n/source-hashes.json に言語ごとに記録しておき、今の日本語と比べる。
//
// 実行:
//   node tools/i18n-stale.js                 古い訳の一覧(なければ何も出さない)。古い訳があると終了コード1
//   node tools/i18n-stale.js --update ko     ko の訳を直したので、ko の記録を今の日本語に合わせる
//   node tools/i18n-stale.js --update all    全言語の記録を今の日本語に合わせる(全訳をそろえた直後)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const readJSON = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const config = readJSON('config.json');
const defLang = config.languages[0].code;
const langs = config.languages.map(l => l.code).filter(c => c !== defLang);
const store = 'data/i18n/source-hashes.json';

// 訳に関係する部分だけをハッシュにする(正解番号・難易度・確認済みフラグの変更では訳し直さない)
const hash = q => crypto.createHash('sha1')
  .update(JSON.stringify([q.question, q.choices, q.explanation, q.choiceNotes ?? null]))
  .digest('hex').slice(0, 12);

const current = {};
for (const f of fs.readdirSync(path.join(root, 'data/questions')).filter(f => f.endsWith('.json'))) {
  for (const q of readJSON(`data/questions/${f}`)) current[q.id] = hash(q);
}

const saved = fs.existsSync(path.join(root, store)) ? readJSON(store) : {};
const args = process.argv.slice(2);

if (args[0] === '--update') {
  const targets = args[1] === 'all' ? langs : args.slice(1);
  const unknown = targets.filter(l => !langs.includes(l));
  if (!targets.length || unknown.length) {
    console.error(`言語を指定してください(${langs.join(' / ')} / all)${unknown.length ? `。不明: ${unknown.join(', ')}` : ''}`);
    process.exit(2);
  }
  for (const l of targets) saved[l] = { ...current };
  fs.writeFileSync(path.join(root, store), JSON.stringify(saved, null, 1) + '\n');
  console.log(`記録を更新しました: ${targets.join(', ')}`);
  process.exit(0);
}

// まだ訳していない問題(その言語では出題しない)は、古い訳ではなく欠落なので数えない(欠落は validate.js が表示する)
const translated = l => {
  const dir = path.join(root, `data/i18n/${l}/questions`);
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => Object.keys(readJSON(`data/i18n/${l}/questions/${f}`))));
};

let stale = 0;
for (const l of langs) {
  const known = saved[l] ?? {};
  const has = translated(l);
  const ids = Object.keys(current).filter(id => has.has(id) && known[id] !== current[id]);
  if (!ids.length) continue;
  stale += ids.length;
  console.log(`[${l}] 訳し直しが必要な問題 ${ids.length} 問: ${ids.slice(0, 20).join(' ')}${ids.length > 20 ? ' …' : ''}`);
}
if (stale) {
  console.log('訳し直したら node tools/i18n-stale.js --update <言語> で記録を更新してください');
  process.exit(1);
}
console.log('OK: すべての言語の訳が、今の日本語に追従しています');
