// PM2 config for money rundown on the MuseShift droplet.
//
// Binds 127.0.0.1:3100 (nginx proxies rundown.museshift.com -> here) via the
// prod entry server-prod.ts — NOT serve.ts, which would try to seize port 3000
// and kill SilverBullet. Bun auto-loads secrets from .env in cwd, so no secrets
// live here. Build first:  bun run build
//
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "money-rundown",
      script: "server-prod.ts",
      interpreter: "/root/.bun/bin/bun",
      cwd: "/root/money-rundown",
      env: {
        NODE_ENV: "production",
        PORT: "3100",
        HOST: "127.0.0.1",
      },
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: "350M",
      out_file: "/root/money-rundown/data/pm2-out.log",
      error_file: "/root/money-rundown/data/pm2-err.log",
    },
  ],
};
