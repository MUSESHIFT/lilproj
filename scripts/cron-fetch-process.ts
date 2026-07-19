/**
 * cron worker — fetch + classify + reconcile for every connected user.
 *
 * Standalone: no HTTP, no session. This is what makes money rundown run on
 * its own. Schedule it (e.g. every 6h) with:  bun run scripts/cron-fetch-process.ts
 */
import { getDb, generateId } from "../src/lib/db";
import { encrypt, decrypt } from "../src/lib/crypto";
import { classifyEmail } from "../src/lib/classifier";
import type { PipelineEmailRecord } from "../src/lib/classifier";
import { runReconciliation } from "../src/lib/reconciliation";

type DB = ReturnType<typeof getDb>;

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

/** Return a valid (fresh) access token, refreshing + re-encrypting if expired. */
async function getValidAccessToken(db: DB, userId: string): Promise<string> {
  const row = db
    .prepare(
      "SELECT access_token, refresh_token, token_expiry FROM gmail_tokens WHERE user_id = ?",
    )
    .get(userId) as
    | { access_token: string; refresh_token: string; token_expiry: string }
    | undefined;
  if (!row) throw new Error("no gmail connection");

  const expiry = new Date(row.token_expiry).getTime();
  if (Date.now() + 60_000 < expiry) return decrypt(row.access_token);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(row.refresh_token),
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`token refresh failed: ${await resp.text()}`);
  const j = (await resp.json()) as { access_token: string; expires_in: number };
  const newExpiry = new Date(Date.now() + j.expires_in * 1000).toISOString();
  db.prepare(
    "UPDATE gmail_tokens SET access_token = ?, token_expiry = ?, updated_at = datetime('now') WHERE user_id = ?",
  ).run(encrypt(j.access_token), newExpiry, userId);
  return j.access_token;
}

/** Prefer text/plain, fall back to text/html, then any nested part. */
function decodeBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        return Buffer.from(p.body.data, "base64").toString("utf-8");
      }
    }
    for (const p of payload.parts) {
      if (p.mimeType === "text/html" && p.body?.data) {
        return Buffer.from(p.body.data, "base64").toString("utf-8");
      }
      const nested = decodeBody(p);
      if (nested) return nested;
    }
  }
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  return "";
}

/** Fetch the last 7 days of messages, storing any not already seen. */
async function fetchRecent(
  db: DB,
  userId: string,
  accessToken: string,
): Promise<number> {
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set("q", "newer_than:7d");
  listUrl.searchParams.set("maxResults", "50");

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!listResp.ok) throw new Error(`gmail list failed: ${await listResp.text()}`);
  const listData = (await listResp.json()) as {
    messages?: { id: string; threadId: string }[];
  };
  if (!listData.messages?.length) return 0;

  const existsStmt = db.prepare(
    "SELECT id FROM emails WHERE gmail_id = ? AND user_id = ?",
  );
  const insertStmt = db.prepare(
    `INSERT INTO emails (id, user_id, gmail_id, thread_id, subject, sender, recipient, date, snippet, body_text, has_attachments, processed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  );

  let added = 0;
  for (const msg of listData.messages) {
    if (existsStmt.get(msg.id, userId)) continue;
    try {
      const detResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      );
      if (!detResp.ok) continue;
      const detail = (await detResp.json()) as {
        id: string;
        threadId: string;
        snippet: string;
        payload?: {
          headers?: { name: string; value: string }[];
        } & GmailPart;
      };
      const headers = detail.payload?.headers ?? [];
      const h = (name: string) =>
        headers.find((x) => x.name.toLowerCase() === name.toLowerCase())
          ?.value ?? "";
      const bodyText = decodeBody(detail.payload);
      const hasAttachments =
        detail.payload?.parts?.some(
          (p) => !!p.filename && p.filename.length > 0,
        ) ?? false;
      insertStmt.run(
        generateId(),
        userId,
        detail.id,
        detail.threadId,
        h("Subject"),
        h("From"),
        h("To"),
        h("Date"),
        detail.snippet,
        bodyText,
        hasAttachments ? 1 : 0,
      );
      added++;
    } catch {
      continue;
    }
  }
  return added;
}

/** Classify every unprocessed email for a user and persist the result. */
function classifyUnprocessed(db: DB, userId: string): number {
  const rows = db
    .prepare(
      "SELECT id, subject, sender, snippet, body_text FROM emails WHERE user_id = ? AND processed = 0",
    )
    .all(userId) as {
    id: string;
    subject: string;
    sender: string;
    snippet: string;
    body_text: string;
  }[];
  if (!rows.length) return 0;

  const update = db.prepare(
    `UPDATE emails SET classified_as = ?, extracted_amount = ?, extracted_currency = ?,
       extracted_invoice_number = ?, extracted_due_date = ?, extracted_sender_name = ?, processed = 1
     WHERE id = ?`,
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      const rec: PipelineEmailRecord = {
        id: r.id,
        subject: r.subject,
        sender: r.sender,
        snippet: r.snippet,
        bodyText: r.body_text,
      };
      const c = classifyEmail(rec);
      update.run(
        c.classification,
        c.extractedAmount,
        c.extractedCurrency,
        c.extractedInvoiceNumber,
        c.extractedDueDate,
        c.extractedSenderName,
        r.id,
      );
    }
  });
  tx();
  return rows.length;
}

async function main(): Promise<void> {
  const db = getDb();
  const users = db.prepare("SELECT user_id FROM gmail_tokens").all() as {
    user_id: string;
  }[];
  console.log(`[fetch-process] ${users.length} connected user(s)`);
  for (const { user_id } of users) {
    try {
      const token = await getValidAccessToken(db, user_id);
      const added = await fetchRecent(db, user_id, token);
      const classified = classifyUnprocessed(db, user_id);
      runReconciliation(user_id);
      console.log(
        `[fetch-process] user ${user_id}: +${added} fetched, ${classified} classified`,
      );
    } catch (e) {
      console.error(
        `[fetch-process] user ${user_id} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  console.log("[fetch-process] done");
}

main();
