import { createFileRoute } from "@tanstack/react-router";
import { getDb, generateId } from "~/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { ok: false, error: "invalid json body" },
            { status: 400 },
          );
        }

        const email =
          typeof body === "object" &&
          body !== null &&
          typeof (body as { email?: unknown }).email === "string"
            ? (body as { email: string }).email.trim()
            : "";

        if (!email || !EMAIL_RE.test(email)) {
          return Response.json(
            { ok: false, error: "please enter a valid email" },
            { status: 400 },
          );
        }

        const db = getDb();
        // INSERT OR IGNORE makes this idempotent: a repeat email hits the
        // UNIQUE constraint and is silently skipped, still a success.
        db.prepare(
          "INSERT OR IGNORE INTO waitlist (id, email) VALUES (?, ?)",
        ).run(generateId(), email.toLowerCase());

        return Response.json({ ok: true }, { status: 200 });
      },
    },
  },
});
