// 図(data/figures/{図ID}.svg)の文字の翻訳。build.js と validate.js から使う。
// 図は既定言語の文字で描き、ほかの言語は data/i18n/{言語}/figures.json の { 図ID: { 元の文字: 訳 } } で置き換える。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'data/figures');

// 図IDの一覧と中身
export const figures = () => Object.fromEntries((fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter(f => f.endsWith('.svg')).map(f => [f.slice(0, -4), fs.readFileSync(path.join(dir, f), 'utf8').trim()]));

// 翻訳が必要な文字(かな・漢字・全角記号を含むもの)。Ec や VGS などの記号はそのまま使う
export const needsTr = s => /[　-鿿＀-￯]/.test(s);

// 図の中の文字(<text> などの中身)の一覧
export const figureLabels = svg => [...new Set([...svg.matchAll(/>([^<>]+)</g)].map(m => m[1].trim()).filter(Boolean))];

// 文字を訳に置き換える。訳が足りなければ null(その言語では図を出さない)
export function localizeFigure(svg, map, isDef) {
  if (isDef) return svg;
  if (figureLabels(svg).some(s => needsTr(s) && map?.[s] == null)) return null;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return svg.replace(/>([^<>]+)</g, (m, s) => (map?.[s.trim()] != null ? `>${esc(map[s.trim()])}<` : m));
}
