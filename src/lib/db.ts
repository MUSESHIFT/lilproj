import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_DIR = join(__dirname, "..", "..", "data");
const DB_PATH = join(DB_DIR, "invoicesleuth.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  // Gmail OAuth tokens
  _db.exec(`
    CREATE TABLE IF NOT EXISTS gmail_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expiry TEXT NOT NULL,
      gmail_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Fetched emails
  _db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gmail_id TEXT NOT NULL,
      thread_id TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT '',
      recipient TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      has_attachments INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_gmail_tokens_user_id ON gmail_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
    CREATE INDEX IF NOT EXISTS idx_emails_gmail_id ON emails(gmail_id);
  `);

  return _db;
}

// Generate a random ID
export function generateId(): string {
  return crypto.randomUUID();
}
