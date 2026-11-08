import "./env.mjs";
import crypto from "node:crypto";
import util from "node:util";
import pg from "pg";

const scryptAsync = util.promisify(crypto.scrypt);

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, Buffer.from(salt, "hex"), SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString("hex")}`;
}

async function main() {
  const args = process.argv.slice(2);
  const email = (args[0] || "").trim().toLowerCase();
  const newPassword = args[1] || "";

  if (!email || !newPassword) {
    console.error("Penggunaan: npm run user:reset-password -- <email> <new_password>");
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error("Gagal: Kata sandi baru minimal 8 karakter.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Gagal: DATABASE_ADMIN_URL atau DATABASE_URL belum diatur.");
    process.exit(1);
  }

  const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
  const client = new pg.Client({ connectionString, ssl });

  try {
    await client.connect();

    const userRes = await client.query("SELECT id, email, display_name FROM users WHERE lower(email) = $1", [email]);
    if (userRes.rows.length === 0) {
      console.error(`Gagal: Pengguna dengan email "${email}" tidak ditemukan.`);
      process.exit(1);
    }

    const user = userRes.rows[0];
    const passwordHash = await hashPassword(newPassword);

    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, user.id]);
    const sessionRes = await client.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
    await client.query("COMMIT");

    console.log(`Sukses: Kata sandi untuk "${user.email}" berhasil direset!`);
    console.log(`  Sesi aktif dicabut: ${sessionRes.rowCount} sesi.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`Gagal mereset kata sandi: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

