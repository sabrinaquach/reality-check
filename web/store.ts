/**
 * Accounts, sessions, and the listings people save to them.
 *
 * Everything else in this server is a stateless proxy: it holds the keys the
 * browser must not see, forwards the request, and forgets. This file is the
 * one exception, because an account is by definition something that outlives
 * the request.
 *
 * SQLite because it ships inside Node (22.6+, which package.json already
 * requires), so accounts cost a file on disk rather than a service to run
 * beside the app. One file, one process, no connection string, and `rm
 * data/app.db` is a clean slate.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.DB_FILE ?? join(HERE, "data", "app.db");

mkdirSync(dirname(FILE), { recursive: true });
const db = new DatabaseSync(FILE);

/**
 * Foreign keys are off by default in SQLite, which would let a session outlive
 * the user it belongs to. WAL so a read during a write does not block.
 */
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

/**
 * There is no password column: both ways in prove the address instead. A magic
 * link proves it by arriving there, and Google proves it by saying so, which
 * is why signing in either way lands on the same row rather than making a
 * second account.
 *
 * (An app.db created before this keeps a now-unused password_hash column.
 * Nothing reads it; `rm data/app.db` if you would rather it were gone.)
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    google_sub TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );

  -- Sign-in links, one row per link.
  --
  -- The token is stored hashed. It is a credential for the few minutes it
  -- lives, so a copy of this file -- a backup, a stray dump -- should not hand
  -- anyone a working way into an account. used_at is what makes a link single
  -- use: a link in an inbox is forwardable, and a second press should do
  -- nothing.
  CREATE TABLE IF NOT EXISTS login_tokens (
    token_hash TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Its own table rather than columns on users: an avatar is a blob next to a
  -- row of short strings, most accounts will never have one, and adding it
  -- here means an existing app.db needs no migration.
  CREATE TABLE IF NOT EXISTS avatars (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bytes      BLOB NOT NULL,
    type       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- The whole check, not just the address: the Saved tab reopens a result
  -- without paying the ~8 Google calls a rescore would cost, exactly as the
  -- localStorage version did. Address is the identity, so saving the same
  -- place twice updates one row.
  CREATE TABLE IF NOT EXISTS saved (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address    TEXT NOT NULL,
    check_json TEXT NOT NULL,
    saved_at   INTEGER NOT NULL,
    position   INTEGER NOT NULL,
    PRIMARY KEY (user_id, address)
  );
`);

const SESSION_DAYS = 30;

/* ---------- sign-in links ---------- */

/**
 * Fifteen minutes: long enough to walk to another device and open the mail,
 * short enough that a link left in an inbox is not a standing key.
 */
const LINK_MINUTES = 15;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Returns the raw token, which is never stored -- only its hash is. */
export function createLoginToken(email: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), normalizeEmail(email), now, now + LINK_MINUTES * 60 * 1000);
  return token;
}

/**
 * Spend a link. Returns the address it was issued for, or null if it has
 * expired, been used already, or never existed -- all of which are the same
 * answer to whoever is holding it.
 */
export function consumeLoginToken(token: string): string | null {
  const row = db
    .prepare("SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?")
    .get(hashToken(token)) as { email: string; expires_at: number; used_at: number | null } | undefined;
  if (!row || row.used_at !== null || row.expires_at <= Date.now()) return null;
  db.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ?").run(Date.now(), hashToken(token));
  return row.email;
}

/** Housekeeping: spent and stale links are of no further use to anyone. */
export function purgeExpiredTokens() {
  db.prepare("DELETE FROM login_tokens WHERE expires_at <= ? OR used_at IS NOT NULL").run(Date.now());
}

/* ---------- users ---------- */

export type User = { id: string; email: string; google_sub: string | null };

/** One spelling of an address is one account: trimmed and lowercased. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function userByEmail(email: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
  return (row as User) ?? null;
}

export function userByGoogleSub(sub: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub);
  return (row as User) ?? null;
}

export function createUser(opts: { email: string; googleSub?: string | null }): User {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, google_sub, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    normalizeEmail(opts.email),
    opts.googleSub ?? null,
    Date.now(),
  );
  return userByEmail(opts.email)!;
}

/** Signing in with Google to an address that already arrived by link. */
export function linkGoogle(userId: string, sub: string) {
  db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(sub, userId);
}

/* ---------- sessions ---------- */

export function createSession(userId: string): string {
  // 256 bits from the CSPRNG: this string is the credential once it is issued.
  const id = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    id,
    userId,
    now,
    now + SESSION_DAYS * 24 * 60 * 60 * 1000,
  );
  return id;
}

export function userBySession(id: string | null): User | null {
  if (!id) return null;
  const row = db
    .prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > ?`,
    )
    .get(id, Date.now());
  return (row as User) ?? null;
}

export function deleteSession(id: string | null) {
  if (id) db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/** Housekeeping, cheap enough to run on every sign-in. */
export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

/* ---------- profile pictures ---------- */

export function setAvatar(userId: string, bytes: Uint8Array, type: string) {
  db.prepare(
    `INSERT INTO avatars (user_id, bytes, type, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET bytes = excluded.bytes, type = excluded.type,
                                        updated_at = excluded.updated_at`,
  ).run(userId, bytes, type, Date.now());
}

export function getAvatar(userId: string): { bytes: Uint8Array; type: string; updated_at: number } | null {
  const row = db.prepare("SELECT bytes, type, updated_at FROM avatars WHERE user_id = ?").get(userId);
  return (row as { bytes: Uint8Array; type: string; updated_at: number }) ?? null;
}

/**
 * When the picture last changed, or null for an account that has none. It goes
 * out with /api/me so the client can put it in the image URL: the bytes are
 * cacheable forever at a given stamp, and a new upload is simply a new URL.
 */
export function avatarStamp(userId: string): number | null {
  const row = db.prepare("SELECT updated_at FROM avatars WHERE user_id = ?").get(userId) as
    | { updated_at: number }
    | undefined;
  return row?.updated_at ?? null;
}

/* ---------- saved listings ---------- */

export function savedFor(userId: string): unknown[] {
  const rows = db
    .prepare("SELECT check_json FROM saved WHERE user_id = ? ORDER BY position ASC")
    .all(userId) as { check_json: string }[];
  return rows.map((r) => JSON.parse(r.check_json));
}

/**
 * Replace the list wholesale. The client owns the order (most recently saved
 * first) and sends what it has, so reconciling row by row would be inventing a
 * merge the UI never asked for -- and the list is a handful of entries, not a
 * feed.
 */
export function replaceSaved(userId: string, list: { listing: { address: string } }[]) {
  const del = db.prepare("DELETE FROM saved WHERE user_id = ?");
  const ins = db.prepare(
    "INSERT INTO saved (user_id, address, check_json, saved_at, position) VALUES (?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    del.run(userId);
    const now = Date.now();
    const seen = new Set<string>();
    list.forEach((check, i) => {
      const address = check.listing.address.trim().toLowerCase();
      if (seen.has(address)) return; // one row per place, as the UI has it
      seen.add(address);
      ins.run(userId, address, JSON.stringify(check), now, i);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
