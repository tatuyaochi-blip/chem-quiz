// SNS で共有したときの画像(OGP、1200×630)を言語ごとに作り、data/og/{言語}.png に保存する。
// サイト名・ひとこと(config.json の brand.hero)・ドメインを、アイコンと同じグラデーションの上に描く。
// ビルドはこの PNG をそのまま使う(data/og/ がなければ、これまでどおりアイコンを使う)ので、作り直すのは
// サイト名や brand.hero を変えたときだけでよい。
// 実行: node tools/og-image.js(Playwright が必要。見つからないときは PLAYWRIGHT=パス で指定)
import fs from 'node:fs';
import path from 'node:path';
import { iconPng } from './icon.js';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT || 'playwright'));
} catch {
  console.error('Playwright が見つかりません。PLAYWRIGHT=/path/to/playwright/index.mjs を指定してください');
  process.exit(2);
}

const { c1 = '#1d64c8', c2 = '#0b8f72' } = config.icon ?? {};
const icon = `data:image/png;base64,${iconPng(512, config.icon).toString('base64')}`;
const host = config.cname || new URL(config.baseUrl).host + new URL(config.baseUrl).pathname.replace(/\/$/, '');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 文字の形が言語に合うフォント(日本語・繁体字中国語は、それぞれの字形のフォントを先に置く)
const FONTS = {
  ja: '"Inter", "IPAPGothic", "Noto Sans CJK JP", "Hiragino Sans", sans-serif',
  'zh-hant': '"Inter", "WenQuanYi Zen Hei", "Noto Sans CJK TC", "PingFang TC", sans-serif',
};

const html = (L, name, hero) => `<!doctype html><html lang="${L.htmlLang}"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body { background: linear-gradient(135deg, ${c1}, ${c2}); color: #fff; font-family: ${FONTS[L.code] ?? '"Inter", "Liberation Sans", sans-serif'};
    display: flex; flex-direction: column; justify-content: center; padding: 0 96px; box-sizing: border-box; position: relative; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 44px; }
  img { width: 168px; height: 168px; border-radius: 36px; box-shadow: 0 0 0 4px rgba(255,255,255,.55), 0 10px 36px rgba(0,0,0,.25); flex: none; }
  h1 { margin: 0; font-size: ${[...name].length > 12 ? 72 : 88}px; line-height: 1.15; font-weight: 800; letter-spacing: ${L.code === 'en' ? '-0.02em' : '0.02em'}; }
  p { margin: 52px 0 0; font-size: 44px; line-height: 1.4; font-weight: 600; opacity: .95; max-width: 1000px; }
  .host { position: absolute; left: 96px; bottom: 52px; font: 600 30px "Inter", sans-serif; opacity: .85; letter-spacing: .02em; }
</style></head><body>
  <div class="row"><img src="${icon}" alt=""><h1>${esc(name)}</h1></div>
  <p>${esc(hero)}</p>
  <div class="host">${esc(host)}</div>
</body></html>`;

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  fs.mkdirSync(path.join(root, 'data/og'), { recursive: true });
  for (const L of config.languages) {
    const name = config.siteName?.[L.code] ?? config.siteName?.[config.languages[0].code];
    const hero = config.brand?.[L.code]?.hero ?? '';
    await page.setContent(html(L, name, hero), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(root, `data/og/${L.code}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(`${path.relative(root, file)}(${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  }
} finally {
  await browser.close();
}
