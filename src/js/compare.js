// 比較ページ: 表のコピー(スプレッドシートに貼れるタブ区切り)と、ページの共有
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
function flash(btn) {
  const old = btn.textContent;
  btn.textContent = btn.dataset.done;
  setTimeout(() => { btn.textContent = old; }, 1800);
}
const table = document.querySelector('table.compare');
document.querySelector('[data-copy-table]')?.addEventListener('click', async e => {
  const btn = e.currentTarget; // await のあとは currentTarget が null になる
  const rows = [...table.rows].map(r => [...r.cells].map(c => c.textContent.trim().replace(/\s+/g, ' ')).join('\t')).join('\n');
  if (await copy(rows)) flash(btn);
});
document.querySelector('[data-share]')?.addEventListener('click', async e => {
  const btn = e.currentTarget;
  if (navigator.share) {
    try { await navigator.share({ title: document.title, url: location.href }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  if (await copy(location.href)) flash(btn);
});
