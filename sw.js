const CACHE = 'bca-v23';
const ASSETS = ['/', '/index.html', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // chrome-extension, API, 외부 요청은 캐시 안 함
  if (url.startsWith('chrome-extension://')) return;
  if (url.includes('/api/')) return;
  if (url.includes('firebase') || url.includes('googleapis') || url.includes('gstatic')) return;
  if (e.request.method !== 'GET') return;
  if (new URL(url).origin !== self.location.origin) return;

  // 화면(HTML)은 항상 서버에서 새로 받음 → 배포 즉시 새 버전이 보임
  // 인터넷이 끊겼을 때만 저장해 둔 화면을 보여줌
  const isPage = e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html');
  if (isPage) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  // 아이콘 등 정적 파일은 저장본 우선
  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
