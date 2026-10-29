// お問い合わせページ: 問題ページの「誤りを報告」(/contact/?c=分野ID&q=問題ID)から来たとき、
// サイト名・問題ID・問題ページの URL を書いた報告文を出す。フォームは運営者のほかのサイトと共通なので、
// どのサイトのどの問題かが送信内容で分かるように、これをフォームの本文に貼り付けてもらう
const box = document.getElementById('report-box');
const params = new URLSearchParams(location.search);
const ok = v => /^[A-Za-z0-9_-]{1,80}$/.test(v ?? '');
const id = params.get('q');
const cat = params.get('c');
if (box && ok(id)) {
  const url = ok(cat) ? new URL(`${document.documentElement.dataset.home}q/${cat}/${id}/`, location.origin).href : '';
  let tpl = box.dataset.template;
  if (!url) tpl = tpl.split('\n').filter(l => !l.includes('{url}')).join('\n');
  const area = box.querySelector('textarea');
  area.value = tpl.replace('{site}', box.dataset.site).replace('{id}', id).replace('{url}', url);
  box.hidden = false;
  const done = box.querySelector('.report-copied');
  box.querySelector('button').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(area.value); } catch { area.select(); document.execCommand('copy'); }
    done.hidden = false;
  });
}
