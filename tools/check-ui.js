// 画面の表示崩れの検査。ビルド後の docs/ をローカルで配信し、各言語のクイズ画面に
// 「undefined」などが文字として出ていないかをブラウザで確かめる。
// 実行: node tools/check-ui.js(Playwright が必要。見つからないときは PLAYWRIGHT=パス で指定)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const base = new URL(config.baseUrl.replace(/\/?$/, '/')).pathname;
const port = Number(process.env.PORT) || 8091;
const origin = `http://localhost:${port}`;

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT || 'playwright'));
} catch {
  console.error('Playwright が見つかりません。PLAYWRIGHT=/path/to/playwright/index.mjs を指定してください');
  process.exit(2);
}

// 画面に出てはいけない文字列(JS の値がそのまま文字になったもの)
const BAD = ['undefined', '[object '];
// 調べる分野: CATS=分野ID,分野ID で指定できる。指定がなければ、コード付き・図付きの問題がある分野と先頭の分野から3つまで
const qOf = c => JSON.parse(fs.readFileSync(path.join(root, 'data/questions', `${c}.json`), 'utf8'));
const allCats = JSON.parse(fs.readFileSync(path.join(root, 'data/categories.json'), 'utf8')).map(c => c.id)
  .filter(c => fs.existsSync(path.join(root, 'data/questions', `${c}.json`)) && qOf(c).length);
const CATS = process.env.CATS ? process.env.CATS.split(',')
  : [...new Set([allCats.find(c => qOf(c).some(q => q.code)), allCats.find(c => qOf(c).some(q => q.figure)), ...allCats].filter(Boolean))].slice(0, 3);
// その言語で出題できる問題があるか(訳のない分野は、その言語では出題しない)
const hasQs = (L, c) => {
  const f = path.join(root, 'docs/data', L.code, 'q', `${c}.json`);
  return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).length > 0;
};

const server = spawn(process.execPath, [path.join(root, 'tools/serve.js'), String(port)], { stdio: 'ignore' });
const errors = [];
let checked = 0;
try {
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const check = (where, text) => {
    for (const w of BAD) if (text.includes(w)) errors.push(`${where}: 「${w.trim()}」が表示されています`);
  };
  for (const L of config.languages) {
    for (const c of CATS) {
      if (!hasQs(L, c)) continue;
      checked++;
      const url = `${origin}${base}${L.path}quiz/?mode=category&c=${c}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('.choice');
      check(`${L.code} ${c} 出題`, await page.locator('#quiz').innerText());
      await page.locator('.choice').first().click();
      await page.waitForSelector('.feedback:not([hidden])');
      check(`${L.code} ${c} 回答後`, await page.locator('#quiz').innerText());
    }
  }
  await browser.close();
} finally {
  server.kill();
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${config.languages.length} 言語 × ${CATS.length} 分野(${CATS.join(', ')})のうち出題できる ${checked} 画面に表示崩れなし`);
