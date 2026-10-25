# Eleição 2026 – painel de apuração

Painel que acompanha a apuração das Eleições 2026 com os **arquivos públicos do TSE** (`resultados.tse.jus.br`), atualizando sozinho.

> Números parciais e não oficiais até a totalização final. Confirme sempre no site do TSE.

## O que tem

- **Apuração** – Presidente (Brasil e MG), Governador, Senador, Deputado Federal e Deputado Estadual de Minas Gerais, com urnas apuradas, comparecimento e abstenção.
- **Comparativo UF / Cidades** – até 7 UFs ou cidades lado a lado, para todos os cargos, com ordenação por coluna (crescente/decrescente) e visão por partido para deputados.
- **Duelo presidencial** – os dois mais votados no Brasil e em cada UF, pizza de participação das UFs no total apurado e a disputa por região (onde o candidato escolhido foi mais e menos votado).
- **★ Perfis salvos** – candidatos favoritos agrupados por cargo e UF (guardados no navegador).
- **Busca** por nome ou número de candidato em todas as abas.
- **Turno** – seletor de 1º/2º turno (no 2º turno existem Presidente e Governador).

## Como funciona

O navegador não consegue consultar o TSE diretamente (bloqueio de CORS). Por isso as chamadas a `/oficial/ele2026/...` passam por um pequeno intermediário que apenas repassa os arquivos `.json`/`.jws` do TSE:

| Onde roda | Intermediário |
|---|---|
| Vercel | [`api/tse.js`](api/tse.js) (função serverless), acionada por um rewrite em [`vercel.json`](vercel.json) |
| Computador local | [`servidor.js`](servidor.js) (Node.js, sem dependências) |

A página é um único arquivo estático: [`public/index.html`](public/index.html).

## Publicar na Vercel (plano Hobby)

1. Em <https://vercel.com/new>, importe este repositório (`leogvital/eleicao2026`).
2. Deixe o *Framework Preset* em **Other**. O `vercel.json` já define a pasta de saída (`public`); não há build nem variáveis de ambiente.
3. **Deploy.**

Ou pela linha de comando: `vercel login` e depois `vercel --prod` na pasta do projeto.

**Cache e limites do Hobby.** A função responde com `Cache-Control: s-maxage=15`, e o painel usa um parâmetro que muda a cada 15 s. Assim todos os visitantes dividem a mesma resposta no CDN: a quantidade de chamadas à função e ao TSE não cresce com o número de pessoas, e o dado chega com no máximo ~15 s de atraso. A lista de municípios é cacheada por 1 hora. A função só aceita caminhos de arquivos `.json`/`.jws` do TSE (não é um proxy aberto). O plano Hobby é de uso pessoal e não comercial.

## Servidor próprio (Linux + nginx + PM2), atrás da Cloudflare

Instalação usada em produção (`/var/eleicao2026`, processo PM2 `eleicao2026` em `127.0.0.1:3030`):

```bash
git clone https://github.com/leogvital/eleicao2026.git /var/eleicao2026
cd /var/eleicao2026 && pm2 start ecosystem.config.cjs && pm2 save
cp deploy/nginx-eleicao2026.conf /etc/nginx/sites-available/eleicao2026
cp deploy/nginx-eleicao2026-proxy.conf /etc/nginx/snippets/eleicao2026-proxy.conf
# carregue por ÚLTIMO (nome com zz-) para não virar o servidor padrão do nginx:
ln -s /etc/nginx/sites-available/eleicao2026 /etc/nginx/sites-enabled/zz-eleicao2026
nginx -t && systemctl reload nginx
```

Atualizar: `cd /var/eleicao2026 && git pull && pm2 restart eleicao2026`.

**Cloudflare / DNS.** O nginx só atende pelo nome em `server_name` (hoje `eleicao2026.ddns.net`); para outro nome, acrescente-o nos dois blocos. A Cloudflare só faz proxy de nomes que estão em uma zona dela: `*.ddns.net` pertence ao No-IP e não pode ser proxied. Use um nome do seu domínio na Cloudflare (registro **A** para o IP do servidor, ou **CNAME** para o nome do No-IP, com a nuvem laranja) e cadastre esse nome em `server_name`. O bloco 443 usa o certificado Let's Encrypt de `eleicao2026.ddns.net` (emitido com `certbot certonly --webroot -w /var/eleicao2026/certbot-webroot -d <nome> --deploy-hook "systemctl reload nginx"`, renovação automática pelo `certbot.timer`). Ele vale para a Cloudflare em **Full (strict)** quando o nome acessado é o do certificado; para outro nome, emita um certificado para ele ou use um Origin Certificate da Cloudflare.

## Controle de acessos (só no servidor próprio)

O painel conta quantas pessoas acessaram e quantas estão online. A contagem é **anônima**: cada navegador gera um código aleatório (guardado em `localStorage`) e o envia ao próprio servidor a cada 30 s em `POST /api/ping`; não se guarda IP, nome nem outro dado pessoal (só o país, se a Cloudflare informar). "Online" = sinal nos últimos 150 s. Os dados ficam em `data/visitas.json` (ignorado pelo git).

O painel de controle fica em **`/admin`** (usuário e senha, só por HTTPS; `http://` é redirecionado). Mostra online agora, pessoas hoje (horário de Brasília), pessoas no total, aberturas, pico simultâneo, pessoas por hora nas últimas 24 h e quem está online (aba, turno e país). Defina as credenciais em `.env` na pasta do servidor (arquivo ignorado pelo git):

```
ADMIN_USER=admin
ADMIN_PASS=uma-senha-longa
```

Sem `ADMIN_PASS`, o `/admin` fica desativado (404). Depois de editar o `.env`: `pm2 restart eleicao2026`. Cinco senhas erradas bloqueiam o IP por 15 minutos.

## Banner de publicidade

No topo do painel há um banner do <https://zapuaitaki.com.br/>, sorteado ao abrir e trocado por outro (nunca o mesmo em seguida) a cada 30 s, com a etiqueta "Publicidade". As imagens ficam em `public/banners/` (JPEG, 1600×533; ~120 KB cada) e a lista está em `BANNERS` no `public/index.html`. O link leva `utm_source=eleicao2026&utm_medium=banner&utm_content=<banner>`, e os cliques são contados (`POST /api/clique`) e aparecem no `/admin`. Para trocar ou acrescentar banners: coloque o `.jpg` na pasta e inclua `{ id, alt }` em `BANNERS`.

## Rodar no computador

Windows: dê dois cliques em [`Iniciar-Dashboard.bat`](Iniciar-Dashboard.bat). Ele instala o Node.js (via winget) se necessário, encerra execuções anteriores e abre `http://localhost:8080`.

Qualquer sistema com Node.js 20+:

```bash
node servidor.js        # http://localhost:8080  (PORT=9000 para trocar a porta)
```

## Estrutura

```
public/index.html      painel (HTML + JS + CSS em um arquivo)
api/tse.js             função da Vercel que repassa os arquivos do TSE
vercel.json            rewrite /oficial/ele2026/* -> /api/tse e pasta de saída
servidor.js            servidor local equivalente
Iniciar-Dashboard.bat  atalho para Windows
```

## Códigos do TSE usados

| Eleição | 1º turno | 2º turno |
|---|---|---|
| Presidente | 6257 | 6258 |
| Governador, Senador, Deputados | 6259 | 6260 |

Arquivos: `/oficial/ele2026/<eleição>/dados/<uf>/<uf>[<município>]-c<cargo>-e<eleição>-u.jws`, com cargos 1 Presidente, 3 Governador, 5 Senador, 6 Deputado Federal, 7 Deputado Estadual, 8 Deputado Distrital.

## Fonte dos dados

Tribunal Superior Eleitoral – resultados.tse.jus.br. Projeto independente, sem vínculo com o TSE.
