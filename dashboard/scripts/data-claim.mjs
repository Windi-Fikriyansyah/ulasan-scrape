import "./env.mjs";
import pg from "pg";

async function main() {
  const args = process.argv.slice(2);
  const email = (args[0] || "").trim().toLowerCase();

  if (!email) {
    console.error("Penggunaan: npm run data:claim -- <email>");
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
      console.error(`Gagal: Pengguna dengan email "${email}" tidak ditemukan. Buat akun terlebih dahulu.`);
      process.exit(1);
    }

    const user = userRes.rows[0];
    console.log(`Mengklaim data lama (tanpa pemilik) untuk akun: ${user.email} (${user.id})...`);

    await client.query("BEGIN");

    const rReviewJobs = await client.query(
      "UPDATE review_jobs SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rReviews = await client.query(
      "UPDATE reviews SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rLeadJobs = await client.query(
      "UPDATE lead_jobs SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rLeads = await client.query(
      "UPDATE leads SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rFbGroups = await client.query(
      "UPDATE fb_groups SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rPostTemplates = await client.query(
      "UPDATE post_templates SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rPostRuns = await client.query(
      "UPDATE post_runs SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );
    const rPostTargets = await client.query(
      "UPDATE post_targets SET user_id = $1 WHERE user_id IS NULL",
      [user.id]
    );

    await client.query("COMMIT");

    console.log(`Klaim data selesai:`);
    console.log(`  Pekerjaan ulasan (review_jobs)   : ${rReviewJobs.rowCount} baris`);
    console.log(`  Ulasan (reviews)                 : ${rReviews.rowCount} baris`);
    console.log(`  Pekerjaan lead (lead_jobs)       : ${rLeadJobs.rowCount} baris`);
    console.log(`  Tempat usaha lead (leads)        : ${rLeads.rowCount} baris`);
    console.log(`  Grup Facebook (fb_groups)        : ${rFbGroups.rowCount} baris`);
    console.log(`  Template posting (post_templates): ${rPostTemplates.rowCount} baris`);
    console.log(`  Riwayat posting (post_runs)      : ${rPostRuns.rowCount} baris`);
    console.log(`  Target posting (post_targets)    : ${rPostTargets.rowCount} baris`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`Gagal mengklaim data: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

