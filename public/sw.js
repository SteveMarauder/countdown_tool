const CACHE = 'cdtt-clock-v3';
const SHELL = ['./','./index.html','./style.css','./app.mjs','./core.mjs','./config.js','./assets/cdtt-ai-hackathon-logo.svg','./assets/cdtt-ai-hackathon-favicon.svg','./assets/taichung-night.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cdtt-clock-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // 網路優先，GitHub 暫時失效時回退已載入過的畫面；API 絕不使用離線快取。
  event.respondWith(fetch(event.request).then(async response => {
    if (!response.ok) throw new Error('Hosting unavailable');
    const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : new Response('', { status: 503 }))));
});
