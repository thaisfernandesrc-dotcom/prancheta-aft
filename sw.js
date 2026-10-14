// Service worker da Prancheta AFT: guarda o app no aparelho para abrir sem
// internet. Só guarda os arquivos do PRÓPRIO app (tela, modelo, ementário,
// ícones); as marcações da fiscalização ficam no banco do aparelho e não
// passam por aqui. A versão muda a cada publicação: o aparelho baixa a nova
// em segundo plano e ela vale na abertura seguinte.
var VERSAO = "2026.10.14-1022";
var CACHE = "prancheta-app-" + VERSAO;
var ARQUIVOS = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "modelo.html", "ementario.json",
  "icones/icone-192.png", "icones/icone-512.png", "icones/icone-maskable-512.png"];

self.addEventListener("install", function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ARQUIVOS.map(function (u) { return new Request(u, {cache: "reload"}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("prancheta-app-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Primeiro o que está guardado (abre na hora, mesmo sem sinal); sem cópia
// guardada, a rede.
self.addEventListener("fetch", function (ev) {
  var req = ev.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, {ignoreSearch: true}).then(function (achou) {
      if (achou) return achou;
      if (req.mode === "navigate") return c.match("index.html").then(function (idx) { return idx || fetch(req); });
      return fetch(req);
    });
  }));
});
