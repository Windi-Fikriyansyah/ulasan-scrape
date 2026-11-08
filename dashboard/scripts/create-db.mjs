import "./env.mjs";
import pg from "pg";

const { Client } = pg;

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;

  if (!adminUrl) {
    if (appUrl) {
      console.error(
        "\nKesalahan: Variabel lingkungan DATABASE_ADMIN_URL belum diatur di .env.local.\n" +
          "Untuk keamanan isolasi data (Row-Level Security / RLS), operasi database harus dikelola dengan akun administrator (superuser),\n" +
          "sedangkan aplikasi berjalan dengan peran biasa (non-superuser).\n\n" +
          "Silakan tambahkan di file .env.local:\n" +
          "DATABASE_ADMIN_URL=postgres://postgres:KATA_SANDI_ADMIN@localhost:5432/ulasan_tokped\n" +
          "DATABASE_URL=postgres://ulasan_app:KATA_SANDI_APP@localhost:5432/ulasan_tokped\n"
      );
    } else {
      console.error("Kesalahan: Variabel lingkungan DATABASE_ADMIN_URL belum diatur di .env.local.");
    }
    process.exit(1);
  }

  let parsedAdmin;
  try {
    parsedAdmin = new URL(adminUrl);
  } catch (_) {
    console.error("Kesalahan: Format DATABASE_ADMIN_URL tidak valid.");
    process.exit(1);
  }

  const dbName = parsedAdmin.pathname.replace(/^\//, "");
  if (!dbName || !/^[A-Za-z0-9_]+$/.test(dbName)) {
    console.error(
      `Kesalahan: Nama database "${dbName}" tidak valid. Nama database hanya boleh berisi huruf, angka, dan garis bawah (_).`
    );
    process.exit(1);
  }

  const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;

  // 1. Sambung ke database bawaan 'postgres' untuk memeriksa / membuat database target
  const postgresServerUrl = new URL(adminUrl);
  postgresServerUrl.pathname = "/postgres";

  const rootClient = new Client({
    connectionString: postgresServerUrl.href,
    ssl,
  });

  try {
    await rootClient.connect();
  } catch (err) {
    const code = err.code;
    if (code === "28P01") {
      console.error(
        "Kesalahan koneksi (28P01): Kata sandi PostgreSQL untuk DATABASE_ADMIN_URL salah. Periksa kredensial di .env.local."
      );
      process.exit(1);
    } else if (code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      console.error(
        "Kesalahan koneksi (ECONNREFUSED): Server PostgreSQL tidak dapat dihubungi. Pastikan server PostgreSQL sudah berjalan."
      );
      process.exit(1);
    } else {
      console.log(
        `Catatan: Tidak dapat menyambung ke database bawaan 'postgres' (${err.message || code}). Jika menggunakan cloud database terkelola, pembuatan database dilewati.`
      );
    }
  }

  if (rootClient._connected) {
    try {
      const res = await rootClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
      if (res.rows.length > 0) {
        console.log(`Database "${dbName}" sudah ada.`);
      } else {
        await rootClient.query(`CREATE DATABASE "${dbName}"`);
        console.log(`Database "${dbName}" berhasil dibuat.`);
      }
    } catch (err) {
      console.error(`Gagal memeriksa atau membuat database "${dbName}": ${err.message}`);
      process.exit(1);
    } finally {
      await rootClient.end().catch(() => {});
    }
  }

  // 2. Siapkan peran (role) aplikasi non-superuser dari DATABASE_URL
  if (!appUrl) {
    console.warn("Peringatan: DATABASE_URL belum diatur di .env.local. Penyiapan role aplikasi dilewati.");
    return;
  }

  let parsedApp;
  try {
    parsedApp = new URL(appUrl);
  } catch (_) {
    console.error("Kesalahan: Format DATABASE_URL tidak valid.");
    process.exit(1);
  }

  const appRole = decodeURIComponent(parsedApp.username);
  const appPassword = decodeURIComponent(parsedApp.password);

  if (!appRole || !/^[a-z_][a-z0-9_]*$/.test(appRole)) {
    console.error(
      `Kesalahan: Nama role aplikasi "${appRole}" tidak valid. Nama role harus berupa huruf kecil dan angka, diawali huruf/garis bawah (format: ^[a-z_][a-z0-9_]*$).`
    );
    process.exit(1);
  }

  // Sambung ke database target menggunakan akun admin untuk mengonfigurasi role
  const targetClient = new Client({
    connectionString: adminUrl,
    ssl,
  });

  try {
    await targetClient.connect();

    // Buat atau sesuaikan role aplikasi
    // Quote password to prevent SQL injection in password string literal
    const escapedPassword = appPassword.replace(/'/g, "''");

    await targetClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE "${appRole}" WITH LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        ELSE
          ALTER ROLE "${appRole}" WITH LOGIN PASSWORD '${escapedPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    // Berikan hak akses terbatas yang aman (tanpa izin CREATE pada skema publik)
    await targetClient.query(`
      GRANT CONNECT ON DATABASE "${dbName}" TO "${appRole}";
      GRANT USAGE ON SCHEMA public TO "${appRole}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}";
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}";
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}";
      REVOKE CREATE ON SCHEMA public FROM "${appRole}";
    `);

    console.log(
      `Peran aplikasi "${appRole}" berhasil disiapkan (NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS).`
    );
  } catch (err) {
    console.error(`Gagal menyiapkan peran aplikasi: ${err.message}`);
    process.exit(1);
  } finally {
    await targetClient.end().catch(() => {});
  }
}

main();
