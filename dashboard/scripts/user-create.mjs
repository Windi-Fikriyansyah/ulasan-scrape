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
  const password = args[1] || "";
  const displayName = (args[2] || email.split("@")[0] || "").trim();

  if (!email || !password) {
    console.error("Penggunaan: npm run user:create -- <email> <password> [display_name]");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Gagal: Kata sandi minimal 8 karakter.");
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

    const existing = await client.query("SELECT id FROM users WHERE lower(email) = $1", [email]);
    if (existing.rows.length > 0) {
      console.error(`Gagal: Pengguna dengan email "${email}" sudah terdaftar.`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    const res = await client.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, created_at`,
      [email, displayName, passwordHash]
    );

    const user = res.rows[0];
    console.log(`Sukses: Pengguna baru berhasil dibuat!`);
    console.log(`  ID           : ${user.id}`);
    console.log(`  Email        : ${user.email}`);
    console.log(`  Nama Tampilan: ${user.display_name}`);
    console.log(`  Waktu Dibuat : ${user.created_at}`);
  } catch (err) {
    console.error(`Gagal membuat pengguna: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

