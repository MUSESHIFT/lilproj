import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1:";
const KEY_ERROR = "MR_ENCRYPTION_KEY must be a 32-byte key (64 hex chars)";

// Resolve a 32-byte key from process.env.MR_ENCRYPTION_KEY.
// Accepts 64 hex chars or base64 that decodes to exactly 32 bytes.
function getKey(): Buffer {
  const raw = process.env.MR_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(KEY_ERROR);
  }

  const trimmed = raw.trim();

  // 64 hex chars => 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // Otherwise try base64 -> must be exactly 32 bytes
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) {
      return buf;
    }
  } catch {
    // fall through to error
  }

  throw new Error(KEY_ERROR);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString(
    "base64"
  )}:${ct.toString("base64")}`;
}

export function decrypt(value: string): string {
  // Legacy plaintext tolerance: anything not in our format passes through.
  if (typeof value !== "string" || !value.startsWith(PREFIX)) {
    return value;
  }

  const rest = value.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) {
    // Not our well-formed payload — treat as legacy plaintext.
    return value;
  }

  const [ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
