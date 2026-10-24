// Servidor do painel: serve public/index.html e repassa os arquivos públicos do TSE (evita o bloqueio de CORS).
// Mesmo contrato do api/tse.js (Vercel). Aqui há cache em memória: vários visitantes dividem a mesma consulta ao TSE.
// Variáveis: PORT (padrão 8080) e HOST (padrão 0.0.0.0; em produção atrás do nginx use 127.0.0.1).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORTA = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const TSE = "https://resultados.tse.jus.br/oficial/ele2026/";
const PREFIXO = "/oficial/ele2026/";
// Só arquivos de resultado/config (.json/.jws) com caminho simples: não é um proxy aberto.
const CAMINHO_VALIDO = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\/[A-Za-z0-9_\-.]+\.(json|jws)$/;
const TTL_DADOS = 15_000, TTL_CONFIG = 3_600_000, TTL_ERRO = 5_000;

const cache = new Map();   // caminho -> { ate, resp: Promise<{ status, corpo, ttl }> }

function consulta(p) {
  const agora = Date.now();
  const c = cache.get(p);
  if (c && c.ate > agora) return c.resp;                // cache valido ou consulta em andamento (compartilhada)
  if (cache.size > 300) for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
  const resp = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(TSE + p, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
      return { status: r.status, corpo: Buffer.from(await r.arrayBuffer()), ttl: r.ok ? (p.includes("/config/") ? TTL_CONFIG : TTL_DADOS) : TTL_ERRO };
    } catch (e) {
      return { status: e.name === "AbortError" ? 504 : 502, corpo: Buffer.from("erro ao consultar o TSE: " + (e.name === "AbortError" ? "tempo esgotado" : e.message)), ttl: 0 };
    } finally { clearTimeout(timer); }
  })();
  const entrada = { ate: agora + 10_000, resp };
  cache.set(p, entrada);
  resp.then(r => { if (r.ttl) entrada.ate = Date.now() + r.ttl; else cache.delete(p); });
  return resp;
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
    }
    if (pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
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
