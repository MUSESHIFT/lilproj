// Production server entry for a shared host (e.g. the MuseShift droplet).
//
// Unlike serve.ts — which pins :3000 for the sandbox preview and force-frees
// the port (it kills whatever is listening there) — this binds a CONFIGURABLE
// port and never touches other listeners, so it is safe to run alongside other
// services. nginx reverse-proxies the public subdomain to 127.0.0.1:$PORT.
//
// Run `bun run build` first, then start under PM2 (see deploy/ecosystem.config.cjs).
import handler from "./dist/server/server.js";

const PORT = Number(process.env.PORT ?? "3100");
const HOST = process.env.HOST ?? "127.0.0.1";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== "/") {
      const file = Bun.file(CLIENT_DIR + pathname);
      if (await file.exists()) return new Response(file);
    }
    return (
      handler as { fetch: (r: Request) => Response | Promise<Response> }
    ).fetch(req);
  },
});

console.log(`money rundown serving on http://${HOST}:${String(PORT)}`);
