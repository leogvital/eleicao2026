// Funcao da Vercel: repassa os arquivos publicos do TSE (resultados.tse.jus.br) para o painel.
// O navegador nao pode consultar o TSE direto (bloqueio de CORS), por isso a consulta passa por aqui.
// vercel.json reescreve /oficial/ele2026/<caminho> para /api/tse?p=<caminho>.

const TSE = "https://resultados.tse.jus.br/oficial/ele2026/";

// So repassa arquivos de resultado/config (.json/.jws) com caminho simples: nao e um proxy aberto.
const CAMINHO_VALIDO = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\/[A-Za-z0-9_\-.]+\.(json|jws)$/;

module.exports = async (req, res) => {
  const p = Array.isArray(req.query.p) ? req.query.p[0] : req.query.p;
  if (!p || p.includes("..") || !CAMINHO_VALIDO.test(p)) {
    res.status(400).setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send("caminho invalido");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(TSE + p, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal });
    const corpo = Buffer.from(await r.arrayBuffer());
    // Resultados mudam a cada poucos segundos: o CDN guarda 15 s e serve o antigo por mais 30 s enquanto atualiza.
    // A lista de municipios (config) quase nao muda: 1 hora.
    const ttl = p.includes("/config/") ? "public, s-maxage=3600, stale-while-revalidate=86400" : "public, s-maxage=15, stale-while-revalidate=30";
    res.status(r.status);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", r.ok ? ttl : "public, s-maxage=5");
    res.send(corpo);
  } catch (e) {
    res.status(e.name === "AbortError" ? 504 : 502);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send("erro ao consultar o TSE: " + (e.name === "AbortError" ? "tempo esgotado" : e.message));
  } finally {
    clearTimeout(timer);
  }
};
