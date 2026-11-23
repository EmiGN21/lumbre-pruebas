const cacheName = 'lumbre-shell-v21-immersive-reader'
const shell = ['./', './index.html', './style.css', './app.js', './reader-translation-gesture.js', './reader-lookup-speech.js', './legacy-audio-ui.js', './legacy-audio.js', './translations.js', './book-language.js', './pdf-import.js', './library-store.js', './speech-chunk.js', './epub-import.js', './vendor/fflate.mjs', './vendor/pdf.mjs', './vendor/pdf.worker.mjs', './catalog.json', './manifest.webmanifest', './assets/app-192.png', './assets/app-512.png', './assets/app-maskable.png', './assets/favicon.svg', './assets/hero.webp', './assets/quijote.webp', './assets/lazarillo.webp', './assets/leyendas.webp']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== cacheName && key.startsWith('lumbre-shell-')).map(key => caches.delete(key))
  )).then(() => self.clients.claim()))
})

const shellUrls = new Set(shell.map(path => new URL(path, self.location).href))
function isolated(response) {
  if (!response || !response.ok || response.type === 'opaque') return response
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method === 'GET' && url.origin === self.location.origin &&
      (request.mode === 'navigate' ||
       url.pathname === new URL('./vendor/ocr/worker.min.js', self.location).pathname ||
       url.pathname === new URL('./vendor/pdf.worker.mjs', self.location).pathname)) {
    event.respondWith(fetch(request).then(isolated).catch(async () => {
      const cache = await caches.open(cacheName)
      const cached = await cache.match(request) ?? (request.mode === 'navigate' ? await cache.match('./') : undefined)
      return isolated(cached) ?? Response.error()
    }))
    return
  }
  if (request.method !== 'GET' || (!shellUrls.has(request.url) &&
    !(request.mode === 'navigate' && new URL(request.url).pathname === new URL('./', self.location).pathname &&
      new URL(request.url).origin === self.location.origin))) return
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(cacheName)
    return (await cache.match(request, { ignoreSearch: request.mode === 'navigate' })) ??
      (request.mode === 'navigate' ? await cache.match('./') : undefined) ?? Response.error()
  }))
})
