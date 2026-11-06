import "./env.mjs";
import pg from "pg";

const { Client } = pg;

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("Kesalahan: Variabel lingkungan DATABASE_URL belum diatur di .env.local.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    console.error("Kesalahan: Format DATABASE_URL tidak valid.");
    process.exit(1);
  }

  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName || !/^[A-Za-z0-9_]+$/.test(dbName)) {
    console.error(
      `Kesalahan: Nama database "${dbName}" tidak valid. Nama database hanya boleh berisi huruf, angka, dan garis bawah (_).`
    );
    process.exit(1);
  }

  const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;

  // Sambung ke database bawaan 'postgres' pada server yang sama
  const adminUrl = new URL(rawUrl);
  adminUrl.pathname = "/postgres";

  const client = new Client({
    connectionString: adminUrl.href,
    ssl,
  });

  try {
    await client.connect();
  } catch (err) {
    const code = err.code;
    if (code === "28P01") {
      console.error(
        "Kesalahan koneksi (28P01): Kata sandi PostgreSQL salah. Periksa kembali kredensial DATABASE_URL di .env.local."
      );
      process.exit(1);
    } else if (code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      console.error(
        "Kesalahan koneksi (ECONNREFUSED): Server PostgreSQL tidak dapat dihubungi. Pastikan server PostgreSQL sudah berjalan."
      );
      process.exit(1);
    } else if (code === "42501") {
      console.error(
        "Kesalahan koneksi (42501): Hak akses tidak mencukupi untuk membuat database. Gunakan akun pengguna dengan izin CREATEDB."
      );
      process.exit(1);
    } else {
      // Untuk Postgres terkelola (misal Neon, Supabase) yang database-nya sudah langsung disediakan
      console.log(
        `Catatan: Tidak dapat menyambung ke database bawaan 'postgres' (${err.message || code}). Jika Anda menggunakan Postgres terkelola (Neon, Supabase, dll.), langkah pembuatan database dilewati.`
      );
      return;
    }
  }

  try {
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (res.rows.length > 0) {
      console.log(`Database "${dbName}" sudah ada.`);
    } else {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database "${dbName}" dibuat.`);
    }
  } catch (err) {
    const code = err.code;
    if (code === "42501") {
      console.error(
        "Kesalahan (42501): Pengguna ini tidak memiliki hak akses untuk menjalankan CREATE DATABASE."
      );
      process.exit(1);
    } else {
      console.error(`Gagal memeriksa atau membuat database "${dbName}": ${err.message}`);
      process.exit(1);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main();

