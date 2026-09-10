const CACHE = 'slm-shell-v1';
const SHELL = ['/', '/index.html', '/style.css', '/script.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('/index.html'))));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'DEADLINE_NOTIFICATION') {
    event.waitUntil(self.registration.showNotification(event.data.title || 'Student Life Manager', {
      body: event.data.body || 'You have an upcoming deadline.',
      tag: 'slm-deadline',
      renotify: true,
      data: { url: '/' }
    }));
  }
});
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => list[0]?.focus() || clients.openWindow('/'))); });
