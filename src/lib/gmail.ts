import { createServerFn } from "@tanstack/react-start";
import { getDb, generateId } from "./db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GmailConnection {
  connected: boolean;
  gmailEmail?: string;
}

export interface GmailAuthUrlResult {
  authUrl?: string;
  error?: string;
}

export interface GmailAuthCompleteResult {
  success: boolean;
  error?: string;
}

export interface EmailRecord {
  id: string;
  gmailId: string;
  threadId: string;
  subject: string;
  sender: string;
  recipient: string;
  date: string;
  snippet: string;
  bodyText: string;
  hasAttachments: boolean;
}

// ─── Env helpers ─────────────────────────────────────────────────────────────

function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth credentials are not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

// ─── Session helper ──────────────────────────────────────────────────────────

const SESSION_COOKIE = "is_session";

async function getUserIdFromSession(): Promise<string | null> {
  const { getCookie } = await import("@tanstack/react-start/server");
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;

  const db = getDb();
  const row = db
    .prepare(
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')",
    )
    .get(token) as { user_id: string } | undefined;

  return row?.user_id ?? null;
}

// ─── Token management ────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const { clientId, clientSecret } = getGoogleCredentials();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to refresh access token: ${err}`);
  }

  return response.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getValidAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT access_token, refresh_token, token_expiry FROM gmail_tokens WHERE user_id = ?",
    )
    .get(userId) as
    | { access_token: string; refresh_token: string; token_expiry: string }
    | undefined;

  if (!row) {
    throw new Error("No Gmail connection found");
  }

  // Check if token is expired (with 60-second buffer)
  const expiry = new Date(row.token_expiry).getTime();
  const now = Date.now() + 60_000;

  if (now < expiry) {
    return row.access_token;
  }

  // Refresh the token
  const refreshed = await refreshAccessToken(row.refresh_token);
  const newExpiry = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  db.prepare(
    "UPDATE gmail_tokens SET access_token = ?, token_expiry = ?, updated_at = datetime('now') WHERE user_id = ?",
  ).run(refreshed.access_token, newExpiry, userId);

  return refreshed.access_token;
}

// ─── Server Functions ────────────────────────────────────────────────────────

/**
 * Generate the Google OAuth URL for connecting Gmail.
 */
export const getGoogleOAuthUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<GmailAuthUrlResult> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { error: "not_authenticated" };

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return { error: "google_not_configured" };
    }

    // Use session token prefix as CSRF state
    const { getCookie } = await import("@tanstack/react-start/server");
    const sessionToken = getCookie(SESSION_COOKIE) ?? "";
    const state = sessionToken.slice(0, 32);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
    });

    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();

    return { authUrl };
  },
);

/**
 * Complete the Gmail OAuth flow by exchanging the code for tokens.
 */
export const completeGmailAuth = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const data = d as { code: string; state: string };
    if (!data.code) throw new Error("Authorization code is required");
    return data;
  })
  .handler(async ({ data }): Promise<GmailAuthCompleteResult> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { success: false, error: "not_authenticated" };

    // Validate state (CSRF protection)
    const { getCookie } = await import("@tanstack/react-start/server");
    const sessionToken = getCookie(SESSION_COOKIE) ?? "";
    const expectedState = sessionToken.slice(0, 32);

    if (data.state !== expectedState) {
      return { success: false, error: "state_mismatch" };
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return { success: false, error: "google_not_configured" };
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code: data.code,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        return { success: false, error: "token_exchange_failed" };
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      // Get Gmail profile
      const profileResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            Accept: "application/json",
          },
        },
      );

      if (!profileResponse.ok) {
        return { success: false, error: "profile_failed" };
      }

      const profile = (await profileResponse.json()) as {
        emailAddress: string;
      };

      // Store tokens
      const db = getDb();
      const tokenExpiry = new Date(
        Date.now() + tokenData.expires_in * 1000,
      ).toISOString();

      const existing = db
        .prepare("SELECT id FROM gmail_tokens WHERE user_id = ?")
        .get(userId) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE gmail_tokens
           SET access_token = ?, refresh_token = ?, token_expiry = ?, gmail_email = ?, updated_at = datetime('now')
           WHERE user_id = ?`,
        ).run(
          tokenData.access_token,
          tokenData.refresh_token,
          tokenExpiry,
          profile.emailAddress,
          userId,
        );
      } else {
        const id = generateId();
        db.prepare(
          `INSERT INTO gmail_tokens (id, user_id, access_token, refresh_token, token_expiry, gmail_email)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          userId,
          tokenData.access_token,
          tokenData.refresh_token,
          tokenExpiry,
          profile.emailAddress,
        );
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "unknown_error",
      };
    }
  },
);

/**
 * Get the Gmail connection status for the current user.
 */
export const getGmailConnection = createServerFn({ method: "GET" }).handler(
  async (): Promise<GmailConnection> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { connected: false };

    const db = getDb();
    const row = db
      .prepare("SELECT gmail_email FROM gmail_tokens WHERE user_id = ?")
      .get(userId) as { gmail_email: string } | undefined;

    if (!row) return { connected: false };

    return { connected: true, gmailEmail: row.gmail_email };
  },
);

/**
 * Disconnect Gmail for the current user.
 */
export const disconnectGmail = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ success: boolean }> => {
    const userId = await getUserIdFromSession();
    if (!userId) throw new Error("Not authenticated");

    const db = getDb();
    db.prepare("DELETE FROM gmail_tokens WHERE user_id = ?").run(userId);

    return { success: true };
  },
);

/**
 * Fetch recent emails from Gmail API for the current user.
 */
export const fetchRecentEmails = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ emails: EmailRecord[]; count: number; error?: string }> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { emails: [], count: 0, error: "Not authenticated" };

    try {
      const accessToken = await getValidAccessToken(userId);

      // Fetch message list (last 7 days, up to 50 messages)
      const listUrl = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      );
      listUrl.searchParams.set("q", "newer_than:7d");
      listUrl.searchParams.set("maxResults", "50");

      const listResponse = await fetch(listUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!listResponse.ok) {
        const err = await listResponse.text();
        return { emails: [], count: 0, error: `Gmail API error: ${err}` };
      }

      const listData = (await listResponse.json()) as {
        messages?: { id: string; threadId: string }[];
      };

      if (!listData.messages || listData.messages.length === 0) {
        return { emails: [], count: 0 };
      }

      const db = getDb();
      const emails: EmailRecord[] = [];

      // Fetch full details for each message and store in DB
      for (const msg of listData.messages) {
        try {
          // Check if we already have this email
          const existing = db
            .prepare("SELECT id FROM emails WHERE gmail_id = ? AND user_id = ?")
            .get(msg.id, userId) as { id: string } | undefined;

          if (existing) continue;

          const detailResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            },
          );

          if (!detailResponse.ok) continue;

          const detail = (await detailResponse.json()) as {
            id: string;
            threadId: string;
            snippet: string;
            payload?: {
              headers?: { name: string; value: string }[];
              parts?: {
                mimeType: string;
                body?: { data?: string; size: number };
                filename?: string;
              }[];
              body?: { data?: string; size: number };
              mimeType?: string;
            };
          };

          // Extract headers
          const headers = detail.payload?.headers ?? [];
          const getHeader = (name: string) =>
            headers.find(
              (h) => h.name.toLowerCase() === name.toLowerCase(),
            )?.value ?? "";

          // Extract body text
          let bodyText = "";
          const payload = detail.payload;

          if (payload) {
            if (payload.parts) {
              // Multipart — prefer plain text
              for (const part of payload.parts) {
                if (part.mimeType === "text/plain" && part.body?.data) {
                  bodyText = Buffer.from(part.body.data, "base64").toString(
                    "utf-8",
                  );
                  break;
                }
              }
              // Fallback to HTML
              if (!bodyText) {
                for (const part of payload.parts) {
                  if (part.mimeType === "text/html" && part.body?.data) {
                    bodyText = Buffer.from(part.body.data, "base64").toString(
                      "utf-8",
                    );
                    break;
                  }
                }
              }
            } else if (
              payload.mimeType === "text/plain" &&
              payload.body?.data
            ) {
              bodyText = Buffer.from(payload.body.data, "base64").toString(
                "utf-8",
              );
            } else if (payload.body?.data) {
              bodyText = Buffer.from(payload.body.data, "base64").toString(
                "utf-8",
              );
            }
          }

          // Check for attachments
          const hasAttachments =
            payload?.parts?.some((p) => !!p.filename && p.filename.length > 0) ??
            false;

          const emailId = generateId();
          const subject = getHeader("Subject");
          const sender = getHeader("From");
          const recipient = getHeader("To");
          const date = getHeader("Date");

          db.prepare(
            `INSERT INTO emails (id, user_id, gmail_id, thread_id, subject, sender, recipient, date, snippet, body_text, has_attachments, processed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          ).run(
            emailId,
            userId,
            detail.id,
            detail.threadId,
            subject,
            sender,
            recipient,
            date,
            detail.snippet,
            bodyText,
            hasAttachments ? 1 : 0,
          );

          emails.push({
            id: emailId,
            gmailId: detail.id,
            threadId: detail.threadId,
            subject,
            sender,
            recipient,
            date,
            snippet: detail.snippet,
            bodyText,
            hasAttachments,
          });
        } catch {
          // Skip individual message errors
          continue;
        }
      }

      return { emails, count: emails.length };
    } catch (err) {
      return {
        emails: [],
        count: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
);

/**
 * Get the count of stored emails for the current user.
 */
export const getEmailCount = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ count: number }> => {
    const userId = await getUserIdFromSession();
    if (!userId) return { count: 0 };

    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as count FROM emails WHERE user_id = ?")
      .get(userId) as { count: number } | undefined;

    return { count: row?.count ?? 0 };
  },
);
