import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;

  if (!adminUrl) {
    if (appUrl) {
      console.error(
        "\nKesalahan: Variabel lingkungan DATABASE_ADMIN_URL belum diatur di .env.local.\n" +
          "Untuk menjalankan migrasi skema dan RLS, script memerlukan akun administrator (DATABASE_ADMIN_URL).\n\n" +
          "Silakan tambahkan di file .env.local:\n" +
          "DATABASE_ADMIN_URL=postgres://postgres:KATA_SANDI_ADMIN@localhost:5432/ulasan_tokped\n" +
          "DATABASE_URL=postgres://ulasan_app:KATA_SANDI_APP@localhost:5432/ulasan_tokped\n"
      );
    } else {
      console.error("Kesalahan: Variabel lingkungan DATABASE_ADMIN_URL belum diatur di .env.local.");
    }
    process.exit(1);
  }

  const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
  const client = new Client({
    connectionString: adminUrl,
    ssl,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error(`Kesalahan koneksi database: ${err.message}`);
    process.exit(1);
  }

  try {
    // 1. Buat tabel schema_migrations bila belum ada
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz default now()
      )
    `);

    // 2. Ambil daftar migrasi yang sudah pernah diterapkan
    const appliedRes = await client.query("select name from schema_migrations");
    const appliedSet = new Set(appliedRes.rows.map((r) => r.name));

    // 3. Baca folder migrations secara berurutan
    const migrationsDir = path.resolve(__dirname, "../db/migrations");
    if (!fs.existsSync(migrationsDir)) {
      console.log("Folder migrasi tidak ditemukan.");
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      console.log(`Menjalankan migrasi: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Migrasi berhasil diterapkan: ${file}`);
        count++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`Gagal menerapkan migrasi ${file}: ${err.message}`);
        process.exit(1);
      }
    }

    // Pastikan hak akses tabel baru diberikan kepada role aplikasi jika ada
    if (appUrl) {
      try {
        const parsedApp = new URL(appUrl);
        const appRole = decodeURIComponent(parsedApp.username);
        if (appRole && /^[a-z_][a-z0-9_]*$/.test(appRole)) {
          await client.query(`
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}";
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}";
          `);
        }
      } catch (_) {}
    }

    if (count === 0) {
      console.log("Database sudah mutakhir. Tidak ada migrasi baru.");
    } else {
      console.log(`Selesai. ${count} migrasi berhasil diterapkan.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main();
