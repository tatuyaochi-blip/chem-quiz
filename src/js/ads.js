// 広告枠。ページ内の <div data-ad="名前"></div> を slot() の結果に置き換える。
// 広告ユニットID は config.json の adsenseSlots（枠の名前 → ID、"default" は既定）で決め、
// build.js が <html> の data-adsense-* に出力する。IDのない枠は空のままにする（自動広告には影響しない）。
// クイズ画面では読み込まない（build.js で ads:false のページは除外）。

const root = document.documentElement;
let slots = {};
try { slots = JSON.parse(root.dataset.adsenseSlots || '{}'); } catch {}

export function slot(name) {
  const el = document.createElement('aside');
  el.className = 'ad-slot';
  el.dataset.slot = name;
  if (root.hasAttribute('data-ad-ph')) el.textContent = `AD (${name})`;
  const id = slots[name] || slots.default;
  if (id && root.dataset.adsenseClient) {
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = root.dataset.adsenseClient;
    ins.dataset.adSlot = id;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    el.append(ins);
  }
  return el;
}

// 広告の読み込み要求は、枠がページに入ってから出す
document.querySelectorAll('[data-ad]').forEach(p => {
  const el = slot(p.dataset.ad);
  p.replaceWith(el);
  if (el.querySelector('ins')) try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
});
