// sw.js — 오프라인 캐시 (같은 출처: 네트워크 우선 → 캐시 폴백 / CDN·폰트: 캐시 후 갱신)
// ⚠ 업데이트할 때마다 js/ui.js의 APP_VERSION과 같은 값으로 올릴 것 (일기 데이터는 캐시와 무관 — 지워지지 않음)
const CACHE = 'eotu-v2.3.1';
const SHELL = [
  './', './index.html', './style.css', './manifest.json',
  './js/ui.js', './js/storage.js', './js/analyzer.js', './js/search.js', './js/config.js', './js/samples.js', './js/gdrive.js', './js/templates.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      // cache: 'no-cache' → 브라우저 HTTP 캐시(GitHub Pages max-age=600)를 쓰지 않고 서버에 새 버전 확인
      //  (바뀐 게 없으면 304로 가볍게 끝남) → 업데이트가 10분 지연 없이 바로 반영
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
    );
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
  }
  // Supabase API 등 그 외 요청은 브라우저 기본 처리
});
