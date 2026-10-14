(function () {
"use strict";
// Prancheta AFT (app instalável). O app NÃO tem tela de prancheta própria: ele
// guarda no aparelho o arquivo prancheta-OS<nº>.html de cada OS e o abre numa
// moldura. Quem desenha, marca, carimba e exporta é o código do próprio
// arquivo, o mesmo que abre no computador; por isso o que sai no Exportar é o
// arquivo de sempre, que o assistente lê e junta na pasta da OS.
//
// Dois bancos no aparelho, os dois só deste app:
//  - "prancheta-app": a lista de OS (oss) e o arquivo de cada uma (arquivos);
//  - "prancheta-aft": as marcações, que o arquivo da prancheta grava sozinho a
//    cada toque (é o mesmo banco que ele usa aberto direto no navegador).
// Nada vai a servidor nenhum.
var VERSAO = "2026.10.14-1";
var MARCA = '<script id="dados-prancheta" type="application/json">';
var MARCA_EM = '<script id="ementario-prancheta" type="application/json">';
var FIM = "<\/script>";
var BD_APP = "prancheta-app", BD_PR = "prancheta-aft";

// ------------------------------------------------------------ utilidades
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
  return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
function dois(n) { return (n < 10 ? "0" : "") + n; }
function agoraIso() { return new Date().toISOString(); }
function ts(x) { var t = x ? Date.parse(x) : NaN; return isNaN(t) ? 0 : t; }
function quando(iso) { var d = new Date(ts(iso)); return dois(d.getDate()) + "/" + dois(d.getMonth() + 1)
  + " às " + dois(d.getHours()) + ":" + dois(d.getMinutes()); }
function toast(t, ms) { var el = document.createElement("div"); el.className = "toast"; el.textContent = t;
  document.body.appendChild(el); setTimeout(function () { el.remove(); }, ms || 3000); }
// Mesma chave que o arquivo da prancheta usa para guardar as marcações.
function chave(d) { return "prancheta|" + (d.os || "") + "|" + (d.ri || ""); }
function mb(n) { return (n / 1048576).toFixed(1).replace(".", ",") + " MB"; }

// ------------------------------------------------------------ bancos no aparelho
function abrirBd(nome) {
  return new Promise(function (ok, nao) {
    var r = indexedDB.open(nome, 1);
    r.onupgradeneeded = function () {
      var db = r.result;
      if (nome === BD_APP) { db.createObjectStore("oss"); db.createObjectStore("arquivos"); }
      else db.createObjectStore("estados");
    };
    r.onsuccess = function () { ok(r.result); };
    r.onerror = function () { nao(r.error); };
  });
}
function bd(nome, loja, modo, fazer) {
  return abrirBd(nome).then(function (db) { return new Promise(function (ok, nao) {
    var t = db.transaction(loja, modo), q = fazer(t.objectStore(loja));
    t.oncomplete = function () { db.close(); ok(q ? q.result : undefined); };
    t.onerror = t.onabort = function () { db.close(); nao(t.error); };
  }); });
}
var oss = {
  todas: function () { return bd(BD_APP, "oss", "readonly", function (s) { return s.getAll(); }); },
  ler: function (k) { return bd(BD_APP, "oss", "readonly", function (s) { return s.get(k); }); },
  gravar: function (r) { return bd(BD_APP, "oss", "readwrite", function (s) { s.put(r, r.chave); }); },
  tirar: function (k) { return bd(BD_APP, "oss", "readwrite", function (s) { s.delete(k); }); }
};
var arquivos = {
  ler: function (k) { return bd(BD_APP, "arquivos", "readonly", function (s) { return s.get(k); }); },
  gravar: function (k, html) { return bd(BD_APP, "arquivos", "readwrite", function (s) { s.put(html, k); }); },
  tirar: function (k) { return bd(BD_APP, "arquivos", "readwrite", function (s) { s.delete(k); }); }
};
var marcacoes = {
  ler: function (k) { return bd(BD_PR, "estados", "readonly", function (s) { return s.get(k); }); },
  tirar: function (k) { return bd(BD_PR, "estados", "readwrite", function (s) { s.delete(k); s.delete("arquivo|" + k); }); }
};
// Pede ao Android que não apague estes dados para liberar espaço.
function pedirPersistencia() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(armazenamento).catch(function () {});
}

// ------------------------------------------------------------ configuração do carimbo (OS em branco)
var CFG = "prancheta-app|carimbo";
function config() { try { return JSON.parse(localStorage.getItem(CFG) || "{}"); } catch (e) { return {}; } }
function gravarConfig(c) { try { localStorage.setItem(CFG, JSON.stringify(c)); } catch (e) {} }
function aprenderCarimbo(c) {
  if (!c || !c.nome) return;
  var cfg = config();
  if (cfg.nome && cfg.cargo_cif) return;
  cfg.nome = cfg.nome || c.nome; cfg.cargo_cif = cfg.cargo_cif || c.cargo_cif || "";
  gravarConfig(cfg); mostrarConfig();
}
function mostrarConfig() { var c = config(); $("cfg-nome").value = c.nome || ""; $("cfg-cargo").value = c.cargo_cif || ""; }
["cfg-nome", "cfg-cargo"].forEach(function (id) {
  $(id).addEventListener("input", function () {
    var c = config(); c.nome = $("cfg-nome").value.trim(); c.cargo_cif = $("cfg-cargo").value.trim(); gravarConfig(c);
  });
});

// ------------------------------------------------------------ o arquivo da prancheta
function blocoDados(html) {
  var i = html.indexOf(MARCA); if (i < 0) return null;
  var c = i + MARCA.length, f = html.indexOf(FIM, c); if (f < 0) return null;
  try { return {dados: JSON.parse(html.slice(c, f) || "{}"), c: c, f: f}; } catch (e) { return null; }
}
function resumo(s) {
  var r = {tot: 0, feitos: 0, irr: 0, semDesf: 0, duv: 0, acresc: 0};
  (s && s.itens || []).forEach(function (it) {
    if (it.apagado) return;
    if (it.origem === "os") { r.tot++; if (it.situacao) r.feitos++; } else r.acresc++;
    if (it.situacao === "irregular") { r.irr++; if (!Object.keys(it.desfechos || {}).length) r.semDesf++; }
    if (it.duvida) r.duv++;
  });
  return r;
}

// Guarda no aparelho o arquivo de uma OS. Se a OS já está aqui, troca o
// arquivo: as marcações do aparelho não se perdem, porque a prancheta, ao
// abrir, junta o arquivo com o que está guardado e fica o mais novo de cada item.
function guardarArquivo(html, nomeArq, perguntar) {
  var b = blocoDados(html);
  if (!b || !b.dados.os) {
    alert("Este arquivo não é uma prancheta de OS. Escolha o arquivo prancheta-OS….html da pasta prancheta da OS.");
    return Promise.resolve(null);
  }
  var d = b.dados, k = chave(d);
  return oss.ler(k).then(function (ant) {
    if (ant && perguntar && !confirm("A OS " + d.os + " já está neste celular.\n\nTrocar pelo arquivo escolhido? "
        + "Nada do que você marcou no celular se perde: ao abrir, a prancheta junta o arquivo com o celular e fica o mais novo de cada item.")) return null;
    var reg = ant || {chave: k, criado_em: agoraIso(), exportado_em: null};
    reg.os = d.os; reg.ri = d.ri || ""; reg.empresa = d.empresa || "";
    reg.arquivo = nomeArq || reg.arquivo || ""; reg.importado_em = agoraIso();
    reg.tamanho = html.length;
    if (!ant) { reg.resumo = resumo(d); reg.salvo_em = d.salvo_em || null; }
    return arquivos.gravar(k, html).then(function () { return oss.gravar(reg); }).then(function () {
      aprenderCarimbo(d.carimbo); pedirPersistencia(); return reg;
    });
  });
}
$("btn-importar").addEventListener("click", function () { $("arquivo").value = ""; $("arquivo").click(); });
$("arquivo").addEventListener("change", function () {
  var f = this.files && this.files[0]; if (!f) return;
  toast("Abrindo " + f.name + "…", 2000);
  f.text().then(function (txt) { return guardarArquivo(txt, f.name, true); })
    .then(function (reg) { if (reg) { listar(); abrir(reg.chave); } })
    .catch(function () { alert("Não consegui ler esse arquivo."); });
});

// OS em branco: o modelo da prancheta e o ementário vêm junto com o app.
$("btn-nova").addEventListener("click", function () {
  $("form-nova").reset();
  var c = config();
  if (!c.nome || !/CIF \d/.test(c.cargo_cif || ""))
    toast("Preencha antes, no fim da tela, o nome e o CIF do carimbo das fotos.", 4500);
  $("dlg-nova").showModal();
});
$("dlg-nova").addEventListener("close", function () {
  if ($("dlg-nova").returnValue !== "ok") return;
  var os = $("nova-os").value.replace(/\D/g, ""), ri = $("nova-ri").value.split(",").map(function (p) {
    return p.replace(/\D/g, ""); }).filter(Boolean).join(","), emp = $("nova-empresa").value.trim();
  if (!os) { alert("Informe o número da OS."); return; }
  var k = chave({os: os, ri: ri});
  oss.ler(k).then(function (ant) {
    if (ant) { alert("A OS " + os + " já está neste celular."); return null; }
    return criarEmBranco(os, ri, emp);
  }).then(function (reg) { if (reg) { listar(); abrir(reg.chave); } })
    .catch(function () { alert("Não consegui criar a prancheta. Abra o app com internet uma vez, para ele baixar o modelo."); });
});
function texto(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.text(); }); }
function criarEmBranco(os, ri, empresa) {
  var cfg = config();
  return Promise.all([texto("modelo.html"), texto("ementario.json")]).then(function (r) {
    var html = r[0].replace("<title>Prancheta de Inspeção</title>", "<title>Prancheta OS " + esc(os) + "</title>");
    var i = html.indexOf(MARCA_EM), j = html.indexOf(FIM, i + MARCA_EM.length);
    if (i >= 0 && j > i) html = html.slice(0, i + MARCA_EM.length) + r[1].trim().replace(/</g, "\\u003c") + html.slice(j);
    var dados = {versao: 3, os: os, ri: ri, empresa: empresa, cnpj: "",
      carimbo: {titulo: "Registro Fotográfico de Inspeção", nome: cfg.nome || "", cargo_cif: cfg.cargo_cif || "",
                estabelecimento: empresa, atualizado_em: null},
      gerado_em: agoraIso(), salvo_em: null, salvo_por: "app", itens: [], observacoes: "", observacoes_em: null};
    var b = blocoDados(html);
    html = html.slice(0, b.c) + JSON.stringify(dados).replace(/<\//g, "<\\/") + html.slice(b.f);
    return guardarArquivo(html, "prancheta-OS" + os + ".html", false);
  });
}

// ------------------------------------------------------------ lista
function listar() {
  return oss.todas().then(function (lst) {
    lst.sort(function (a, b) { return ts(b.aberto_em || b.importado_em) - ts(a.aberto_em || a.importado_em); });
    if (!lst.length) { $("lista").innerHTML = '<p class="vazio">Nenhuma OS ainda. Toque em Abrir arquivo da OS.</p>'; return; }
    $("lista").innerHTML = lst.map(function (o) {
      var r = o.resumo || {}, partes = [];
      if (r.tot) partes.push(r.feitos + "/" + r.tot + " ementas marcadas");
      if (r.acresc) partes.push(r.acresc + " constatação(ões)");
      if (r.irr) partes.push(r.irr + " irregular(es)" + (r.semDesf ? ", " + r.semDesf + " sem desfecho" : ""));
      if (r.duv) partes.push(r.duv + " pendente(s) de confirmação");
      var pend = o.salvo_em && ts(o.salvo_em) > ts(o.exportado_em);
      var sit = pend ? '<div class="sit pendente">⚠ Mudanças de ' + quando(o.salvo_em) + " ainda não exportadas para a pasta da OS.</div>"
        : o.exportado_em ? '<div class="sit ok">✓ Exportada em ' + quando(o.exportado_em) + ".</div>" : "";
      return '<div class="os" data-k="' + esc(o.chave) + '"><div class="cab">OS ' + esc(o.os) + (o.ri ? " · RI " + esc(o.ri) : "") + "</div>"
        + (o.empresa ? '<div class="emp">' + esc(o.empresa) + "</div>" : "")
        + (partes.length ? '<div class="num">' + partes.join(" · ") + "</div>" : "")
        + sit
        + '<div class="acoes"><button class="btn cheio peq" type="button" data-acao="abrir">Abrir</button>'
        + '<button class="btn perigo peq" type="button" data-acao="tirar">Remover do celular</button></div></div>';
    }).join("");
  }).catch(function () {
    $("lista").innerHTML = '<p class="vazio">⚠ Este navegador não está deixando o app guardar dados. Abra pelo Chrome, fora da aba anônima.</p>';
  });
}
$("lista").addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-acao]"); if (!b) return;
  var k = b.closest(".os").getAttribute("data-k");
  if (b.getAttribute("data-acao") === "abrir") abrir(k);
  else tirar(k);
});
function tirar(k) {
  oss.ler(k).then(function (o) {
    if (!o) return;
    var pend = o.salvo_em && ts(o.salvo_em) > ts(o.exportado_em);
    var msg = "Remover a OS " + o.os + " deste celular?\n\n" + (pend
      ? "ATENÇÃO: há mudanças que ainda NÃO foram exportadas. Elas se perdem. Exporte antes."
      : "Fotos e marcações saem do celular. O arquivo exportado na pasta da OS continua lá.");
    if (!confirm(msg)) return;
    if (pend && !confirm("Tem certeza? As mudanças não exportadas da OS " + o.os + " vão se perder.")) return;
    return Promise.all([oss.tirar(k), arquivos.tirar(k), marcacoes.tirar(k)]).then(function () {
      toast("OS " + o.os + " removida do celular."); listar(); armazenamento(); });
  });
}

// ------------------------------------------------------------ prancheta aberta
var aberta = null;   // {chave, iframe, url}
function abrir(k) {
  if (aberta) fechar(true);
  Promise.all([oss.ler(k), arquivos.ler(k)]).then(function (r) {
    var o = r[0], html = r[1];
    if (!o || !html) { alert("Não achei o arquivo desta OS no celular. Abra o arquivo da OS de novo."); return; }
    var url = URL.createObjectURL(new Blob([html], {type: "text/html"}));
    var fr = document.createElement("iframe");
    fr.setAttribute("allow", "web-share; camera; fullscreen");
    fr.title = "Prancheta da OS " + o.os;
    fr.src = url;
    fr.addEventListener("load", function () { ajustarDentro(fr, k); });
    $("moldura").innerHTML = ""; $("moldura").appendChild(fr);
    $("rotulo-os").textContent = "OS " + o.os + (o.empresa ? " · " + o.empresa : "");
    $("tela-lista").hidden = true; $("tela-prancheta").hidden = false;
    aberta = {chave: k, iframe: fr, url: url};
    // O voltar do Android volta à lista, em vez de fechar o app.
    if (!history.state || history.state.tela !== "prancheta") history.pushState({tela: "prancheta"}, "");
    o.aberto_em = agoraIso(); o.aberta = true; oss.gravar(o);
  });
}
// A prancheta grava no aparelho 0,4 s depois de cada toque: a moldura só sai
// depois disso, para não perder o último toque de quem volta depressa.
function fechar(semHistorico) {
  if (!aberta) return;
  var a = aberta; aberta = null;
  $("tela-prancheta").hidden = true; $("tela-lista").hidden = false;
  if (!semHistorico && history.state && history.state.tela === "prancheta") history.back();
  setTimeout(function () {
    if (a.iframe.parentNode) a.iframe.remove();
    URL.revokeObjectURL(a.url);
    atualizarResumo(a.chave).then(listar);
  }, 1500);
  listar();
}
$("btn-voltar").addEventListener("click", function () { fechar(false); });
window.addEventListener("popstate", function () { if (aberta) fechar(true); });

function atualizarResumo(k) {
  return Promise.all([oss.ler(k), marcacoes.ler(k)]).then(function (r) {
    var o = r[0], s = r[1]; if (!o) return;
    if (s) { o.resumo = resumo(s); o.salvo_em = s.salvo_em || o.salvo_em; }
    o.aberta = false;
    return oss.gravar(o);
  }).catch(function () {});
}

// Dentro da moldura: o botão "Salvar arquivo" do arquivo vira "Exportar" (no
// celular ele já abre o compartilhar do Android). Os avisos do rodapé passam a
// falar em exportar. A troca é só na tela: o arquivo exportado sai igual ao de
// sempre, com "Salvar arquivo" para quem o abrir no computador.
var TROCAS = [
  ["Arquivo ainda não salvo com as últimas mudanças.", "Últimas mudanças ainda não exportadas."],
  ["Arquivo salvo às ", "Exportado às "],
  ["Use Salvar arquivo com frequência.", "Use Exportar com frequência."],
  ["Salve o arquivo após cada foto.", "Exporte após cada foto."],
  ["Salve o arquivo para levar essas mudanças à pasta da OS.", "Toque em Exportar para levar essas mudanças à pasta da OS."],
  ["Clique em Salvar arquivo para levar tudo à pasta da OS.", "Toque em Exportar para levar tudo à pasta da OS."]
];
function retexto(el) {
  if (!el) return;
  var t = el.textContent, n = t;
  TROCAS.forEach(function (p) { n = n.split(p[0]).join(p[1]); });
  if (n !== t) el.textContent = n;
}
function ajustarDentro(fr, k) {
  var doc; try { doc = fr.contentDocument; } catch (e) { return; }
  if (!doc) return;
  var btn = doc.getElementById("btn-salvar"), st = doc.getElementById("status"), app = doc.getElementById("app");
  // Exportação concluída = o rodapé passa a dizer "Arquivo salvo às hh:mm"
  // depois de um toque no botão (no celular, quando o compartilhar termina).
  // No computador, que grava sozinho no arquivo, vale cada nova hora gravada.
  var exportando = false, ultimo = "";
  if (btn) { btn.textContent = "Exportar"; btn.addEventListener("click", function () { exportando = true; }, true); }
  if (st) {
    var vigia = function () {
      var m = st.textContent.match(/(Arquivo salvo às|Salvo no arquivo da pasta da OS às) (\d\d:\d\d)/);
      if (m && (exportando || (m[1] !== "Arquivo salvo às" && m[2] !== ultimo))) {
        exportando = false; ultimo = m[2]; marcarExportada(k);
      }
      retexto(st);
    };
    new MutationObserver(vigia).observe(st, {childList: true, characterData: true, subtree: true});
    vigia();
  }
  if (app) {
    var avisos = function () { retexto(app.querySelector(".aviso")); };
    new MutationObserver(avisos).observe(app, {childList: true});
    avisos();
  }
}
function marcarExportada(k) {
  // A marcação mais recente já está no banco do aparelho (a prancheta grava
  // antes de exportar); o resumo pega a hora dela.
  setTimeout(function () {
    Promise.all([oss.ler(k), marcacoes.ler(k)]).then(function (r) {
      var o = r[0], s = r[1]; if (!o) return;
      o.exportado_em = agoraIso();
      if (s) { o.resumo = resumo(s); o.salvo_em = s.salvo_em || o.salvo_em; }
      return oss.gravar(o);
    }).catch(function () {});
  }, 600);
}

// ------------------------------------------------------------ instalar, armazenamento, versão
var pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); pedidoInstalar = e; $("btn-instalar").hidden = false; });
$("btn-instalar").addEventListener("click", function () {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  pedidoInstalar.userChoice.then(function () { pedidoInstalar = null; $("btn-instalar").hidden = true; });
});
window.addEventListener("appinstalled", function () { $("btn-instalar").hidden = true; toast("Prancheta instalada. Abra pelo ícone na tela do celular."); });

function armazenamento() {
  var el = $("armazenamento");
  if (!navigator.storage || !navigator.storage.estimate) { el.textContent = "Este navegador não informa o espaço usado."; return; }
  Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false)])
    .then(function (r) {
      el.textContent = "Usando " + mb(r[0].usage || 0) + " neste celular. "
        + (r[1] ? "✓ Protegido: o Android não apaga estes dados para liberar espaço."
                : "⚠ Ainda não protegido contra limpeza automática do Android. Instale o app pelo Chrome para proteger.");
    }).catch(function () { el.textContent = ""; });
}

$("versao").textContent = "Versão " + VERSAO + " · os dados ficam neste aparelho e só saem pelo Exportar.";
if ("serviceWorker" in navigator) {
  var jaInstalado = !!navigator.serviceWorker.controller;   // primeira abertura não é "atualização"
  navigator.serviceWorker.register("sw.js").then(function (reg) {
    reg.addEventListener("updatefound", function () {
      var nova = reg.installing;
      if (nova) nova.addEventListener("statechange", function () {
        if (nova.state === "activated" && jaInstalado)
          toast("App atualizado. A nova versão vale na próxima abertura.", 4000);
      });
    });
  }).catch(function () {});
}

// Partida: resumo das OS que ficaram abertas (o app pode ter sido fechado com a
// prancheta na tela), e a lista.
mostrarConfig();
oss.todas().then(function (lst) {
  return Promise.all(lst.filter(function (o) { return o.aberta; }).map(function (o) { return atualizarResumo(o.chave); }));
}).catch(function () {}).then(listar);
armazenamento();

// Acesso de conferência (testes): não muda nada sozinho.
window.__app = {guardarArquivo: guardarArquivo, criarEmBranco: criarEmBranco, abrir: abrir, fechar: fechar,
  listar: listar, oss: oss, marcacoes: marcacoes, versao: VERSAO};
})();
