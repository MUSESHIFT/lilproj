// Server-only Gmail OAuth logic.
// This module is only used in route loaders (SSR context) and never imported
// by client code. The `.server.ts` extension tells TanStack Start to exclude
// it from client bundles.

import { getDb, generateId } from "./db";

export async function validateSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const db = getDb();
  const session = db
    .prepare(
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')",
    )
    .get(token) as { user_id: string } | undefined;
  return session?.user_id ?? null;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  email: string;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth credentials are not configured");
  }

  // Exchange the authorization code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Google token exchange failed: ${errText}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Get the user's Gmail address
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
    throw new Error("Failed to fetch Gmail profile");
  }

  const profile = (await profileResponse.json()) as { emailAddress: string };

  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_in: tokenData.expires_in,
    email: profile.emailAddress,
  };
}

export function storeGmailTokens(
  userId: string,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    email: string;
  },
): void {
  const db = getDb();
  const tokenExpiry = new Date(
    Date.now() + tokens.expires_in * 1000,
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
      tokens.access_token,
      tokens.refresh_token,
      tokenExpiry,
      tokens.email,
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
      tokens.access_token,
      tokens.refresh_token,
      tokenExpiry,
      tokens.email,
    );
  }
}

export function buildGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error("Google OAuth credentials are not configured");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}
