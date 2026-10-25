// Servidor do painel: serve public/index.html, repassa os arquivos públicos do TSE (evita o bloqueio de CORS)
// e registra acessos de forma anônima (painel restrito em /admin).
// Mesmo contrato do api/tse.js (Vercel) para os dados; aqui há cache em memória: vários visitantes dividem a consulta ao TSE.
// Variáveis (ou arquivo .env ao lado deste): PORT (8080), HOST (0.0.0.0; em produção 127.0.0.1 atrás do nginx),
// ADMIN_USER (admin), ADMIN_PASS (sem senha = /admin desativado), DATA_DIR (./data).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// .env simples, opcional (não sobrescreve variáveis já definidas)
try {
  for (const l of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* sem .env */ }

const PORTA = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

// ===================== Proxy do TSE com cache =====================
const TSE = "https://resultados.tse.jus.br/oficial/ele2026/";
const PREFIXO = "/oficial/ele2026/";
// Só arquivos de resultado/config (.json/.jws) com caminho simples: não é um proxy aberto.
const CAMINHO_VALIDO = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\/[A-Za-z0-9_\-.]+\.(json|jws)$/;
const TTL_DADOS = 15_000, TTL_CONFIG = 3_600_000, TTL_ERRO = 5_000;
const cache = new Map();   // caminho -> { ate, resp: Promise<{ status, corpo, ttl }> }

// Estado da conexão com o TSE (aparece no /admin): últimas consultas reais dos visitantes + teste ativo a cada 30 s.
const tse = { recentes: [], teste: null, ultimoOk: 0, ultimaFalha: null, desde: Date.now() };
function registraTse(origem, caminho, status, ms, erro) {
  const ok = status >= 200 && status < 300, t = Date.now();
  tse.recentes.push({ t, ok, status, ms, origem });
  if (tse.recentes.length > 200) tse.recentes.shift();
  if (ok) tse.ultimoOk = t; else tse.ultimaFalha = { t, status, caminho, erro: erro || "" };
}

function consulta(p) {
  const agora = Date.now();
  const c = cache.get(p);
  if (c && c.ate > agora) return c.resp;                // cache valido ou consulta em andamento (compartilhada)
  if (cache.size > 300) for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
  const resp = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const ini = Date.now();
      const r = await fetch(TSE + p, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
      const corpo = Buffer.from(await r.arrayBuffer());
      registraTse("visitante", p, r.status, Date.now() - ini);
      return { status: r.status, corpo, ttl: r.ok ? (p.includes("/config/") ? TTL_CONFIG : TTL_DADOS) : TTL_ERRO };
    } catch (e) {
      registraTse("visitante", p, e.name === "AbortError" ? 504 : 502, 9000, e.name === "AbortError" ? "tempo esgotado" : e.message);
      return { status: e.name === "AbortError" ? 504 : 502, corpo: Buffer.from("erro ao consultar o TSE: " + (e.name === "AbortError" ? "tempo esgotado" : e.message)), ttl: 0 };
    } finally { clearTimeout(timer); }
  })();
  const entrada = { ate: agora + 10_000, resp };
  cache.set(p, entrada);
  resp.then(r => { if (r.ttl) entrada.ate = Date.now() + r.ttl; else cache.delete(p); });
  return resp;
}

// Teste ativo: busca o arquivo do Presidente (Brasil) direto no TSE, sem cache, a cada 30 s.
const ARQ_TESTE = "6257/dados/br/br-c0001-e006257-u.jws";
async function testaTse() {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 9000), ini = Date.now();
  try {
    const r = await fetch(TSE + ARQ_TESTE, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
    const n = (await r.arrayBuffer()).byteLength, ms = Date.now() - ini;
    tse.teste = { t: Date.now(), ok: r.ok && n > 0, status: r.status, ms, bytes: n };
    registraTse("teste", ARQ_TESTE, r.status, ms);
  } catch (e) {
    const erro = e.name === "AbortError" ? "tempo esgotado" : (e.cause && e.cause.code) || e.message;
    tse.teste = { t: Date.now(), ok: false, status: 0, ms: Date.now() - ini, erro };
    registraTse("teste", ARQ_TESTE, 0, Date.now() - ini, erro);
  } finally { clearTimeout(timer); }
}
testaTse(); setInterval(testaTse, 30_000).unref();

function estadoTse() {
  const agora = Date.now(), janela = tse.recentes.filter(x => agora - x.t <= 600_000), oks = janela.filter(x => x.ok);
  const ms = oks.map(x => x.ms).sort((a, b) => a - b);
  return {
    teste: tse.teste, ultimoOk: tse.ultimoOk, ultimaFalha: tse.ultimaFalha,
    janela: { total: janela.length, falhas: janela.length - oks.length, medioMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null, p95Ms: ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] : null },
    ultimos: tse.recentes.slice(-30).map(x => ({ t: x.t, ok: x.ok, ms: x.ms })),
    cacheItens: cache.size,
  };
}

// ===================== Controle de acessos (anônimo) =====================
// Cada navegador tem um código aleatório (sem IP, nome ou outro dado pessoal) e envia um sinal a cada 30 s.
// "Online" = sinal nos últimos 150 s (abas em segundo plano enviam menos sinais).
const ONLINE_MS = 150_000;
const ARQ = path.join(DATA_DIR, "visitas.json");
const visitas = { desde: Date.now(), visitantes: {}, horas: {}, pico: { n: 0, em: 0 }, cliques: {} };
try { Object.assign(visitas, JSON.parse(fs.readFileSync(ARQ, "utf8"))); } catch (e) { /* primeira execução */ }
visitas.cliques ||= {};
let sujo = false;

const diaBR = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });                                   // AAAA-MM-DD
const horaBR = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 13).replace(" ", "T");      // AAAA-MM-DDTHH
const contaOnline = (agora) => { let n = 0; for (const v of Object.values(visitas.visitantes)) if (agora - v.ultimo <= ONLINE_MS) n++; return n; };

function salva() {
  if (!sujo) return;
  sujo = false;
  try {
    const corte = horaBR(Date.now() - 72 * 3600_000);
    for (const k of Object.keys(visitas.horas)) if (k < corte) delete visitas.horas[k];
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ARQ + ".tmp", JSON.stringify(visitas));
    fs.renameSync(ARQ + ".tmp", ARQ);
  } catch (e) { sujo = true; console.error("falha ao salvar visitas:", e.message); }
}
setInterval(() => { const n = contaOnline(Date.now()); if (n > visitas.pico.n) { visitas.pico = { n, em: Date.now() }; sujo = true; } salva(); }, 15_000).unref();
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { salva(); process.exit(0); });

const novosPorIp = new Map();   // limita a criação de códigos novos por IP (evita inflar a contagem)
function registraPing(b, ip, pais) {
  const id = String(b.id || "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(id)) return;
  const agora = Date.now();
  let v = visitas.visitantes[id];
  if (!v) {
    const r = novosPorIp.get(ip);
    if (r && r.ate > agora) { if (++r.n > 40) return; } else novosPorIp.set(ip, { n: 1, ate: agora + 3600_000 });
    v = visitas.visitantes[id] = { primeiro: agora, ultimo: 0, aberturas: 0, dias: [], sessao: agora };
  }
  if (agora - v.ultimo < 5000 && !b.abertura) return;                  // anti-flood
  if (agora - v.ultimo > 300_000) v.sessao = agora;                    // nova sessão após 5 min sem sinal
  if (b.abertura) v.aberturas++;
  v.ultimo = agora;
  v.aba = String(b.aba || "").slice(0, 12);
  v.turno = b.turno === 2 ? 2 : 1;
  if (pais && /^[A-Za-z]{2}$/.test(pais)) v.pais = pais.toUpperCase();
  const dia = diaBR(agora);
  if (!v.dias.includes(dia)) { v.dias.push(dia); if (v.dias.length > 14) v.dias.shift(); }
  (visitas.horas[horaBR(agora)] ||= {})[id] = 1;
  sujo = true;
}

// Clique em banner de publicidade: conta por banner e quantas pessoas diferentes clicaram
function registraClique(b) {
  const banner = String(b.banner || "");
  if (!/^[a-z0-9\-]{1,24}$/.test(banner)) return;
  const agora = Date.now(), v = visitas.visitantes[String(b.id || "")];
  if (v) { if (agora - (v.ultClique || 0) < 2000) return; v.ultClique = agora; v.cliques = (v.cliques || 0) + 1; }   // anti-flood
  if (!(banner in visitas.cliques) && Object.keys(visitas.cliques).length >= 50) return;
  visitas.cliques[banner] = (visitas.cliques[banner] || 0) + 1;
  sujo = true;
}

function estatisticas() {
  const agora = Date.now(), hoje = diaBR(agora);
  const todos = Object.values(visitas.visitantes);
  const online = todos.filter(v => agora - v.ultimo <= ONLINE_MS);
  const conta = (lista, f) => lista.reduce((o, v) => { const k = f(v) || "?"; o[k] = (o[k] || 0) + 1; return o; }, {});
  const horas = [];
  for (let i = 23; i >= 0; i--) { const k = horaBR(agora - i * 3600_000); horas.push({ dia: k.slice(0, 10), hora: k.slice(11), unicos: Object.keys(visitas.horas[k] || {}).length }); }
  return {
    agora, desde: visitas.desde,
    online: online.length,
    unicosTotal: todos.length,
    unicosHoje: todos.filter(v => v.dias.includes(hoje)).length,
    aberturasTotal: todos.reduce((s, v) => s + (v.aberturas || 0), 0),
    pico: visitas.pico,
    cliques: { total: Object.values(visitas.cliques).reduce((s, n) => s + n, 0), pessoas: todos.filter(v => v.cliques > 0).length, porBanner: visitas.cliques },
    porAba: conta(online, v => v.aba), porTurno: conta(online, v => v.turno), porPais: conta(online, v => v.pais),
    horas, tse: estadoTse(),
    lista: online.sort((a, b) => a.sessao - b.sessao).map(v => ({ desde: v.sessao, aba: v.aba || "?", turno: v.turno || 1, pais: v.pais || "", visitas: v.aberturas || 0 })),
  };
}

// ===================== /admin (senha) =====================
const falhas = new Map();   // ip -> { n, ate }
const igual = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(), crypto.createHash("sha256").update(String(b)).digest());
function autorizado(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const bruto = Buffer.from(h.slice(6), "base64").toString("utf8"), i = bruto.indexOf(":");
  if (i < 0) return false;
  const okUsuario = igual(bruto.slice(0, i), ADMIN_USER), okSenha = igual(bruto.slice(i + 1), ADMIN_PASS);
  return okUsuario && okSenha;
}
function conexaoSegura(req) {
  if (req.headers["x-forwarded-proto"] === "https" || /"scheme":"https"/.test(req.headers["cf-visitor"] || "")) return true;
  return !req.headers["x-forwarded-proto"] && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || "");   // acesso direto por localhost
}
const TIPOS_IMG = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const SEM_CACHE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

function lerCorpo(req, max = 2048) {
  return new Promise((ok, erro) => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > max) { req.destroy(); erro(new Error("corpo grande")); } });
    req.on("end", () => ok(b));
    req.on("error", erro);
  });
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    const ip = req.headers["x-real-ip"] || req.socket.remoteAddress || "?";

    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
    }
    if (pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }

    if (pathname === "/api/ping") {
      if (req.method !== "POST") { res.writeHead(405); return res.end(); }
      try { registraPing(JSON.parse(await lerCorpo(req)), ip, req.headers["cf-ipcountry"]); } catch (e) { /* sinal inválido: ignora */ }
      res.writeHead(204, SEM_CACHE); return res.end();
    }

    if (pathname === "/api/clique") {
      if (req.method !== "POST") { res.writeHead(405); return res.end(); }
      try { registraClique(JSON.parse(await lerCorpo(req))); } catch (e) { /* sinal inválido: ignora */ }
      res.writeHead(204, SEM_CACHE); return res.end();
    }

    // Imagens dos banners (somente arquivos de public/banners)
    if (pathname.startsWith("/banners/")) {
      const nome = path.basename(pathname), ext = path.extname(nome).toLowerCase();
      const arq = path.join(__dirname, "public", "banners", nome);
      if (TIPOS_IMG[ext] && /^[A-Za-z0-9_\-]+\.[a-z]+$/.test(nome) && fs.existsSync(arq)) {
        res.writeHead(200, { "Content-Type": TIPOS_IMG[ext], "Cache-Control": "public, max-age=3600" });
        return res.end(fs.readFileSync(arq));
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("nao encontrado");
    }

    if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/dados") {
      if (!ADMIN_PASS) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("nao encontrado"); }
      if (!conexaoSegura(req)) { res.writeHead(301, { Location: "https://" + (req.headers.host || "") + req.url, ...SEM_CACHE }); return res.end(); }
      const f = falhas.get(ip), agora = Date.now();
      if (f && f.ate > agora) { res.writeHead(429, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(Math.ceil((f.ate - agora) / 1000)), ...SEM_CACHE }); return res.end("muitas tentativas; aguarde alguns minutos"); }
      if (!autorizado(req)) {
        // só conta como tentativa errada quando houve credencial (a 1ª visita sem senha é só o navegador pedindo o login)
        if (req.headers.authorization) {
          const n = (f && agora - f.ult < 15 * 60_000 ? f.n : 0) + 1;                 // erros antigos (>15 min) deixam de contar
          falhas.set(ip, n >= 5 ? { n: 0, ate: agora + 15 * 60_000, ult: agora } : { n, ate: 0, ult: agora });
        }
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Acessos - Eleicao 2026", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8", ...SEM_CACHE });
        return res.end("autenticacao necessaria");
      }
      falhas.delete(ip);
      if (pathname === "/admin/dados") { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...SEM_CACHE }); return res.end(JSON.stringify(estatisticas())); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...SEM_CACHE });
      return res.end(fs.readFileSync(path.join(__dirname, "admin.html")));
    }

    if (pathname.startsWith(PREFIXO)) {
      const p = pathname.slice(PREFIXO.length);
      if (!CAMINHO_VALIDO.test(p) || p.includes("..")) { res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("caminho invalido"); }
      const r = await consulta(p);
      res.writeHead(r.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": r.ttl ? "public, max-age=0, s-maxage=15" : "no-store" });
      return res.end(r.corpo);
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("nao encontrado");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("erro interno: " + e.message);
  }
}).listen(PORTA, HOST, () => console.log(`Dashboard em http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORTA}  (Ctrl+C para encerrar)`));
