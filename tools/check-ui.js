// 画面の表示崩れの検査。ビルド後の docs/ をローカルで配信し、各言語のクイズ画面に
// 「undefined」などが文字として出ていないかをブラウザで確かめる。
// 実行: node tools/check-ui.js(Playwright が必要。見つからないときは PLAYWRIGHT=パス で指定)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const base = new URL(config.baseUrl.replace(/\/?$/, '/')).pathname;
const port = 8091;
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
// コードなし・コード付き・図付きの問題がそれぞれ出る分野
const CATS = ['physics', 'isa-assembly', 'pn-junction'];

const server = spawn(process.execPath, [path.join(root, 'tools/serve.js'), String(port)], { stdio: 'ignore' });
const errors = [];
try {
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const check = (where, text) => {
    for (const w of BAD) if (text.includes(w)) errors.push(`${where}: 「${w.trim()}」が表示されています`);
  };
  for (const L of config.languages) {
    for (const c of CATS) {
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
console.log(`OK: ${config.languages.length} 言語 × ${CATS.length} 分野のクイズ画面に表示崩れなし`);
