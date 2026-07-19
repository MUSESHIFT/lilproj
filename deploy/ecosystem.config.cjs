// PM2 process config for money rundown.
// start with:   pm2 start deploy/ecosystem.config.cjs
// then persist:  pm2 save   (and `pm2 startup` once, to survive reboots)
//
// note: env lives in .env in the app dir. PM2 does not read .env itself, but
// the process here is `bun run serve.ts`, and bun auto-loads .env from cwd —
// so keep `cwd` pointed at the repo root and your .env there.
// (if you prefer PM2 to own the env, swap in `env_file: ".env"` under this app.)

module.exports = {
  apps: [
    {
      name: "money-rundown",
      script: "serve.ts",
      interpreter: "bun",
      // interpreter_args left empty — `bun serve.ts` is the effective command.
      cwd: "/root/money-rundown",
      // serve.ts pins port 3000. make sure nothing else on the droplet
      // already holds 3000 (silverbullet does by default — remap one of them).
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: "300M",
      out_file: "/root/money-rundown/data/pm2-out.log",
      error_file: "/root/money-rundown/data/pm2-err.log",
    },
  ],
};
