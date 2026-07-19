import { createServerFn } from "@tanstack/react-start";
import { getDb, generateId } from "./db";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  created_at: string;
}

// ─── Password hashing (Node crypto, safe for both server and client module load) ─

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

function verifyPassword(password: string, hash: string): boolean {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const derivedKey = scryptSync(password, salt, 64);
  try {
    return timingSafeEqual(derivedKey, Buffer.from(key, "hex"));
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_COOKIE = "is_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ─── Server Functions ─────────────────────────────────────────────────────────

export const signup = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const data = d as { email: string; password: string };
    if (!data.email || !data.password) {
      throw new Error("Email and password are required");
    }
    if (data.password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      throw new Error("Invalid email address");
    }
    return data;
  })
  .handler(async ({ data }) => {
    // Server-only import — only evaluated on the server
    const { setCookie } = await import("@tanstack/react-start/server");

    const db = getDb();

    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(data.email);
    if (existing) {
      return { error: "An account with this email already exists" };
    }

    const passwordHash = hashPassword(data.password);
    const userId = generateId();

    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
    ).run(userId, data.email, passwordHash);

    const token = generateToken();
    const sessionId = generateId();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

    db.prepare(
      "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    ).run(sessionId, userId, token, expiresAt);

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    const user: User = {
      id: userId,
      email: data.email,
      created_at: new Date().toISOString(),
    };

    return { user };
  });

export const login = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const data = d as { email: string; password: string };
    if (!data.email || !data.password) {
      throw new Error("Email and password are required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { setCookie } = await import("@tanstack/react-start/server");

    const db = getDb();

    const row = db
      .prepare(
        "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
      )
      .get(data.email) as {
      id: string;
      email: string;
      password_hash: string;
      created_at: string;
    } | undefined;

    if (!row) {
      return { error: "Invalid email or password" };
    }

    const valid = verifyPassword(data.password, row.password_hash);
    if (!valid) {
      return { error: "Invalid email or password" };
    }

    const token = generateToken();
    const sessionId = generateId();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

    db.prepare(
      "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    ).run(sessionId, row.id, token, expiresAt);

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    const user: User = {
      id: row.id,
      email: row.email,
      created_at: row.created_at,
    };

    return { user };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { getCookie, deleteCookie } = await import(
    "@tanstack/react-start/server"
  );

  const token = getCookie(SESSION_COOKIE);
  if (token) {
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { success: true };
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getCookie } = await import("@tanstack/react-start/server");

    const token = getCookie(SESSION_COOKIE);
    if (!token) return { user: null };

    const db = getDb();
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`,
      )
      .get(token) as { id: string; email: string; created_at: string } | undefined;

    return { user: row ?? null };
  },
);
