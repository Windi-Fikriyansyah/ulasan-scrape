import crypto from "node:crypto";
import { type NextRequest } from "next/server";
import { queryAuth } from "./pg";

function scryptAsync(
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export const SESSION_COOKIE_NAME = "ut_session";
const SESSION_ROLLING_DAYS = 30;
const SESSION_MAX_DAYS = 90;

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  sessionId?: string;
}

// Precomputed dummy hash to mitigate timing attacks on non-existent emails
let dummyHashCache = "";
async function getDummyHash(): Promise<string> {
  if (!dummyHashCache) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync("dummy-pass-123", Buffer.from(salt, "hex"), SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    })) as Buffer;
    dummyHashCache = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString("hex")}`;
  }
  return dummyHashCache;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, Buffer.from(salt, "hex"), SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") {
      return false;
    }
    const n = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], "hex");
    const expectedKey = Buffer.from(parts[5], "hex");

    const derivedKey = (await scryptAsync(password, salt, expectedKey.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    })) as Buffer;

    if (derivedKey.length !== expectedKey.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch (_) {
    return false;
  }
}

export async function performDummyPasswordCheck(password: string): Promise<void> {
  const dummy = await getDummyHash();
  await verifyPassword(password, dummy);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function getClientIp(req: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

export async function checkRateLimit(ip: string, email: string): Promise<{ blocked: boolean; message?: string }> {
  const normEmail = email.trim().toLowerCase();
  try {
    // Bersihkan data lama lebih dari 24 jam secara asinkron
    queryAuth("DELETE FROM auth_attempts WHERE at < now() - interval '24 hours'").catch(() => {});

    // Periksa batas IP: max 20 gagal per 15 menit
    const ipCheck = await queryAuth<{ count: string }>(
      `SELECT count(*) FROM auth_attempts
       WHERE key = $1 AND kind = 'login' AND ok = false AND at > now() - interval '15 minutes'`,
      [`ip:${ip}`]
    );
    if (parseInt(ipCheck.rows[0]?.count || "0", 10) >= 20) {
      return {
        blocked: true,
        message: "Terlalu banyak percobaan gagal dari IP ini. Silakan coba lagi setelah 15 menit.",
      };
    }

    // Periksa batas Email: max 5 gagal per 15 menit
    if (normEmail) {
      const emailCheck = await queryAuth<{ count: string }>(
        `SELECT count(*) FROM auth_attempts
         WHERE key = $1 AND kind = 'login' AND ok = false AND at > now() - interval '15 minutes'`,
        [`email:${normEmail}`]
      );
      if (parseInt(emailCheck.rows[0]?.count || "0", 10) >= 5) {
        return {
          blocked: true,
          message: "Terlalu banyak percobaan login gagal untuk akun ini. Silakan coba lagi setelah 15 menit.",
        };
      }
    }

    return { blocked: false };
  } catch (err: any) {
    return { blocked: false };
  }
}

export async function recordAuthAttempt(ip: string, email: string, success: boolean): Promise<void> {
  try {
    const normEmail = email.trim().toLowerCase();
    await queryAuth(
      `INSERT INTO auth_attempts (key, kind, ok) VALUES ($1, 'login', $2), ($3, 'login', $2)`,
      [`ip:${ip}`, success, `email:${normEmail}`]
    );
  } catch (_) {
    // abaikan kegagalan pencatatan attempt
  }
}

export async function createSession(userId: string, req: NextRequest): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const ip = getClientIp(req);
  const ua = (req.headers.get("user-agent") || "").slice(0, 500);

  const expiresAt = new Date(Date.now() + SESSION_ROLLING_DAYS * 24 * 60 * 60 * 1000);

  await queryAuth(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt.toISOString(), ua, ip]
  );

  return { token, expiresAt };
}

export async function getSessionUser(req: NextRequest): Promise<AuthUser | null> {
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieToken) return null;

  const tokenHash = hashToken(cookieToken);

  const res = await queryAuth<{
    session_id: string;
    session_created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    id: string;
    email: string;
    display_name: string;
    disabled: boolean;
  }>(
    `SELECT s.id as session_id, s.created_at as session_created_at, s.last_seen_at, s.expires_at,
            u.id, u.email, u.display_name, u.disabled
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );

  const row = res.rows[0];
  if (!row) return null;

  if (row.disabled) {
    await queryAuth("DELETE FROM sessions WHERE id = $1", [row.session_id]);
    return null;
  }

  const now = Date.now();
  const expiresAt = new Date(row.expires_at).getTime();
  const createdAt = new Date(row.session_created_at).getTime();
  const absoluteMaxExpires = createdAt + SESSION_MAX_DAYS * 24 * 60 * 60 * 1000;

  if (now > expiresAt || now > absoluteMaxExpires) {
    await queryAuth("DELETE FROM sessions WHERE id = $1", [row.session_id]);
    return null;
  }

  // Rolling refresh jika sudah lewat 5 menit sejak last_seen_at
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (now - lastSeen > 5 * 60 * 1000) {
    const nextRolling = now + SESSION_ROLLING_DAYS * 24 * 60 * 60 * 1000;
    const finalExpires = new Date(Math.min(nextRolling, absoluteMaxExpires));
    queryAuth(
      "UPDATE sessions SET last_seen_at = now(), expires_at = $1 WHERE id = $2",
      [finalExpires.toISOString(), row.session_id]
    ).catch(() => {});
  }

  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    sessionId: row.session_id,
  };
}

export function validateEmail(email: string): boolean {
  if (!email || email.length < 3 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < 8) {
    return { valid: false, reason: "Password minimal 8 karakter." };
  }
  if (password.length > 128) {
    return { valid: false, reason: "Password maksimal 128 karakter." };
  }
  return { valid: true };
}
