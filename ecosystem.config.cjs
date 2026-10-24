// PM2 (servidor Linux): processo único, só em localhost; o nginx (e a Cloudflare na frente) fazem o acesso externo.
module.exports = {
  apps: [
    {
      name: "eleicao2026",
      script: "servidor.js",
      cwd: __dirname,
      env: { PORT: "3030", HOST: "127.0.0.1" },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "250M",
    },
  ],
};
