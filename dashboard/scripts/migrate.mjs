import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("Kesalahan: Variabel lingkungan DATABASE_URL belum diatur di .env.local.");
    process.exit(1);
  }

  const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
  const client = new Client({
    connectionString: rawUrl,
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

