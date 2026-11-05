// プッシュ通知を受け取るための小さなプログラム（Service Worker）
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'pokèmon card game big', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'favicon.png', badge: 'favicon.png', data: { kind: d.kind || '' },
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var kind = (e.notification.data && e.notification.data.kind) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if ('focus' in c) { c.postMessage({ t: 'openfriend', kind: kind }); return c.focus(); }
    }
    return self.clients.openWindow('./?friend=1');
  }));
});
