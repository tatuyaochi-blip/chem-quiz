// Service Worker の元(tools/build.js が版・保存するファイルの一覧を埋めて docs/sw.js に出力する)
// ネットワークを優先し、つながらないときだけキャッシュを使う。最初の訪問時に問題データなどを保存しておく。
const BASE = {{base}};
// 同じオリジンにほかのサイトがあっても消し合わないよう、キャッシュ名にサイトの位置(BASE)を入れる
const PREFIX = `sq${BASE}`;
const CACHE = `${PREFIX}{{version}}`;
// 各言語のトップ(長い順)。オフラインで未保存のページを開いたときは、その言語のトップを出す
const HOMES = {{homes}};
const PRECACHE = {{precache}};
// 言語ごとの問題データなど。ページから { lang } が届いたら、その言語の分だけ保存する
const LANG_DATA = {{langData}};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('message', e => {
  const files = LANG_DATA[e.data?.lang];
  if (!files) return;
  // 保存済みの印があれば何もしない(この版で一度だけ)
  const mark = `${BASE}__lang-${e.data.lang}`;
  e.waitUntil(caches.open(CACHE).then(c => c.match(mark).then(done => done || c.addAll(files)
    .then(() => c.put(mark, new Response('1'))).catch(() => {}))));
});

// 古い版のキャッシュを消す
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && (k.startsWith(PREFIX) || /^sq-/.test(k) && BASE === '/')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })
    // オフライン: 保存してあるもの(クイズ画面の ?mode=… は無視して探す)、なければトップ
    .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })
      .then(res => res || (e.request.mode === 'navigate' ? caches.match(HOMES.find(h => url.pathname.startsWith(h)) || BASE) : Response.error()))));
});
