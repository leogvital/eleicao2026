// Servidor local do dashboard: serve index.html e repassa /oficial/* ao TSE (evita bloqueio de CORS).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORTA = process.env.PORT || 8080;
const TSE = "https://resultados.tse.jus.br";

http.createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url.startsWith("/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
    }
    if (req.url.startsWith("/oficial/ele2026/")) {
      const r = await fetch(TSE + req.url, { headers: { "User-Agent": "Mozilla/5.0" } });
      res.writeHead(r.status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    res.writeHead(404); res.end("nao encontrado");
  } catch (e) {
    res.writeHead(502); res.end("erro ao consultar o TSE: " + e.message);
  }
}).listen(PORTA, () => console.log(`Dashboard em http://localhost:${PORTA}  (Ctrl+C para encerrar)`));
