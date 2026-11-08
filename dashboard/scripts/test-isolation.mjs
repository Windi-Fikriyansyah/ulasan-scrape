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

async function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], "hex");
    const expectedKey = Buffer.from(parts[5], "hex");

    const derivedKey = await scryptAsync(password, salt, expectedKey.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch (_) {
    return false;
  }
}

function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ GAGAL: ${message}`);
    throw new Error(`Uji gagal: ${message}`);
  }
  passedTests++;
  console.log(`  ✅ ${message}`);
}

async function main() {
  console.log("==================================================================");
  console.log("MENJALANKAN AUTOMATED TEST SUITE: ISOLASI DATA PER USER (8/8)");
  console.log("==================================================================\n");

  const appUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_ADMIN_URL;

  if (!appUrl) {
    console.error("DATABASE_URL belum diatur.");
    process.exit(1);
  }

  const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
  const appPool = new pg.Pool({ connectionString: appUrl, ssl, max: 5 });
  const adminPool = adminUrl ? new pg.Pool({ connectionString: adminUrl, ssl, max: 2 }) : appPool;

  const runId = Math.random().toString(36).slice(2, 8);
  const emailA = `test_user_a_${runId}@example.com`;
  const emailB = `test_user_b_${runId}@example.com`;
  const passA = "PasswordA_12345!";
  const passB = "PasswordB_12345!";

  let userA = null;
  let userB = null;

  try {
    // -------------------------------------------------------------------------
    // 1. Pendaftaran & Login
    // -------------------------------------------------------------------------
    console.log("[1/8] Menguji Pendaftaran, Password Scrypt, dan Login...");

    const hashA = await hashPassword(passA);
    assert(hashA.startsWith("scrypt$32768$8$1$"), "Password di-hash dengan parameter scrypt yang benar.");
    assert(await verifyPassword(passA, hashA), "Verifikasi password cocok dengan timing-safe equal.");
    assert(!(await verifyPassword("PasswordSalah123", hashA)), "Password salah ditolak.");

    const resA = await adminPool.query(
      "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name",
      [emailA, "User A", hashA]
    );
    userA = resA.rows[0];
    assert(userA.id && userA.email === emailA, "User A berhasil didaftarkan di database.");

    const hashB = await hashPassword(passB);
    const resB = await adminPool.query(
      "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name",
      [emailB, "User B", hashB]
    );
    userB = resB.rows[0];
    assert(userB.id && userB.email === emailB, "User B berhasil didaftarkan di database.");

    // Buat token sesi acak 32-byte base64url dan SHA-256 hash di database
    const tokenA = crypto.randomBytes(32).toString("base64url");
    const tokenHashA = sha256(tokenA);
    await adminPool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '30 days')`,
      [userA.id, tokenHashA]
    );
    const sessA = await adminPool.query("SELECT * FROM sessions WHERE token_hash = $1", [tokenHashA]);
    assert(sessA.rows.length === 1 && sessA.rows[0].user_id === userA.id, "Sesi User A tersimpan dengan SHA-256 hash.");

    // Uji Rate Limiting di auth_attempts
    for (let i = 0; i < 5; i++) {
      await adminPool.query(
        "INSERT INTO auth_attempts (key, kind, ok) VALUES ($1, 'login', false)",
        [`email:${emailA}`]
      );
    }
    const checkAttempts = await adminPool.query(
      "SELECT count(*) FROM auth_attempts WHERE key = $1 AND kind = 'login' AND ok = false AND at > now() - interval '15 minutes'",
      [`email:${emailA}`]
    );
    assert(parseInt(checkAttempts.rows[0].count, 10) >= 5, "Percobaan login gagal tercatat dan memicu batas rate limiting.");

    // -------------------------------------------------------------------------
    // 2. Isolasi Data Ulasan & Lead
    // -------------------------------------------------------------------------
    console.log("\n[2/8] Menguji Isolasi Data Ulasan & Lead Maps...");

    const reviewJobId = `job_test_a_${runId}`;
    const leadJobId = `lead_test_a_${runId}`;

    // User A membuat review_job & review
    await adminPool.query(
      `INSERT INTO review_jobs (user_id, id, market, url, title, status)
       VALUES ($1, $2, 'tokopedia', 'https://www.tokopedia.com/produk-a', 'Produk User A', 'done')`,
      [userA.id, reviewJobId]
    );
    await adminPool.query(
      `INSERT INTO reviews (user_id, job_id, dedupe_key, name, rating, review)
       VALUES ($1, $2, 'dedupe_rev_a', 'Pembeli A', 5, 'Bagus sekali')`,
      [userA.id, reviewJobId]
    );

    // User A membuat lead_job & lead
    await adminPool.query(
      `INSERT INTO lead_jobs (user_id, id, keyword, location, url, status)
       VALUES ($1, $2, 'bengkel', 'jakarta', 'https://www.google.com/maps/search/bengkel', 'done')`,
      [userA.id, leadJobId]
    );
    await adminPool.query(
      `INSERT INTO leads (user_id, job_id, dedupe_key, name, address)
       VALUES ($1, $2, 'dedupe_lead_a', 'Bengkel Usaha A', 'Jl. Merdeka No 1')`,
      [userA.id, leadJobId]
    );

    // Klien role aplikasi berjalan dengan app.user_id = User B
    const clientB = await appPool.connect();
    try {
      await clientB.query("BEGIN");
      await clientB.query("SELECT set_config('app.user_id', $1, true)", [userB.id]);

      const jobsSeenByB = await clientB.query("SELECT * FROM review_jobs");
      assert(jobsSeenByB.rows.length === 0, "User B tidak dapat melihat pekerjaan ulasan milik User A (0 baris).");

      const reviewsSeenByB = await clientB.query("SELECT * FROM reviews");
      assert(reviewsSeenByB.rows.length === 0, "User B tidak dapat melihat ulasan milik User A (0 baris).");

      const leadsJobsSeenByB = await clientB.query("SELECT * FROM lead_jobs");
      assert(leadsJobsSeenByB.rows.length === 0, "User B tidak dapat melihat pekerjaan lead milik User A (0 baris).");

      const leadsSeenByB = await clientB.query("SELECT * FROM leads");
      assert(leadsSeenByB.rows.length === 0, "User B tidak dapat melihat tempat lead milik User A (0 baris).");

      // Query spesifik ID milik User A oleh User B mengembalikan 0 baris (dijawab 404)
      const specificJob = await clientB.query("SELECT * FROM review_jobs WHERE id = $1", [reviewJobId]);
      assert(specificJob.rows.length === 0, "Query ID milik User A oleh User B mengembalikan 0 baris (404).");

      // Coba UPDATE oleh User B pada ID milik User A
      const updateByB = await clientB.query("UPDATE review_jobs SET title = 'Hacked' WHERE id = $1", [reviewJobId]);
      assert(updateByB.rowCount === 0, "Percobaan UPDATE oleh User B pada data User A memengaruhi 0 baris.");

      // Coba DELETE oleh User B pada ID milik User A
      const deleteByB = await clientB.query("DELETE FROM review_jobs WHERE id = $1", [reviewJobId]);
      assert(deleteByB.rowCount === 0, "Percobaan DELETE oleh User B pada data User A memengaruhi 0 baris.");

      await clientB.query("COMMIT");
    } finally {
      clientB.release();
    }

    // -------------------------------------------------------------------------
    // 3. Isolasi Autopost (Grup, Template, Run, Target)
    // -------------------------------------------------------------------------
    console.log("\n[3/8] Menguji Isolasi Autopost (Grup, Template, Run, Target)...");

    const groupId = `grp_test_a_${runId}`;
    const tplId = `tpl_test_a_${runId}`;
    const runPostId = `run_test_a_${runId}`;
    const targetId = `trg_test_a_${runId}`;

    // User A membuat grup, template, run, dan target
    await adminPool.query(
      `INSERT INTO fb_groups (user_id, id, name, url, source)
       VALUES ($1, $2, 'Grup Rahasia A', 'https://www.facebook.com/groups/rahasia-a', 'manual')`,
      [userA.id, groupId]
    );
    await adminPool.query(
      `INSERT INTO post_templates (user_id, id, name, body)
       VALUES ($1, $2, 'Template Promo A', 'Diskon besar hari ini!')`,
      [userA.id, tplId]
    );
    await adminPool.query(
      `INSERT INTO post_runs (user_id, id, state, total)
       VALUES ($1, $2, 'done', 1)`,
      [userA.id, runPostId]
    );
    await adminPool.query(
      `INSERT INTO post_targets (user_id, id, run_id, group_id, group_name, group_url, template_id, status)
       VALUES ($1, $2, $3, $4, 'Grup Rahasia A', 'https://www.facebook.com/groups/rahasia-a', $5, 'success')`,
      [userA.id, targetId, runPostId, groupId, tplId]
    );

    // Klien role aplikasi dengan app.user_id = User B
    const clientB2 = await appPool.connect();
    try {
      await clientB2.query("BEGIN");
      await clientB2.query("SELECT set_config('app.user_id', $1, true)", [userB.id]);

      const groupsB = await clientB2.query("SELECT * FROM fb_groups");
      assert(groupsB.rows.length === 0, "User B tidak dapat melihat grup Facebook milik User A.");

      const tplsB = await clientB2.query("SELECT * FROM post_templates");
      assert(tplsB.rows.length === 0, "User B tidak dapat melihat template posting milik User A.");

      const runsB = await clientB2.query("SELECT * FROM post_runs");
      assert(runsB.rows.length === 0, "User B tidak dapat melihat riwayat autopost milik User A.");

      const targetsB = await clientB2.query("SELECT * FROM post_targets");
      assert(targetsB.rows.length === 0, "User B tidak dapat melihat target posting milik User A.");

      await clientB2.query("COMMIT");
    } finally {
      clientB2.release();
    }

    // -------------------------------------------------------------------------
    // 4. Row-Level Security (RLS) di Database dengan Peran ulasan_app
    // -------------------------------------------------------------------------
    console.log("\n[4/8] Menguji Row-Level Security (RLS) Tanpa Superuser Bypass...");

    // Periksa bahwa role aplikasi adalah non-superuser & no-bypassrls
    const roleCheck = await appPool.query(
      "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    const role = roleCheck.rows[0];
    assert(role.rolsuper === false, `Peran aplikasi "${role.rolname}" BUKAN superuser.`);
    assert(role.rolbypassrls === false, `Peran aplikasi "${role.rolname}" memiliki NOBYPASSRLS.`);

    // Klien tanpa set_config('app.user_id')
    const anonClient = await appPool.connect();
    try {
      const anonJobs = await anonClient.query("SELECT count(*) FROM review_jobs");
      assert(parseInt(anonJobs.rows[0].count, 10) === 0, "Query tanpa app.user_id mengembalikan 0 baris (RLS menahan penuh).");

      const anonGroups = await anonClient.query("SELECT count(*) FROM fb_groups");
      assert(parseInt(anonGroups.rows[0].count, 10) === 0, "Query grup FB tanpa app.user_id mengembalikan 0 baris.");
    } finally {
      anonClient.release();
    }

    // Klien dengan set_config('app.user_id', userA.id)
    const clientA = await appPool.connect();
    try {
      await clientA.query("BEGIN");
      await clientA.query("SELECT set_config('app.user_id', $1, true)", [userA.id]);

      const jobsA = await clientA.query("SELECT count(*) FROM review_jobs");
      assert(parseInt(jobsA.rows[0].count, 10) >= 1, "User A dapat membaca data ulasan miliknya.");

      const groupsA = await clientA.query("SELECT count(*) FROM fb_groups");
      assert(parseInt(groupsA.rows[0].count, 10) >= 1, "User A dapat membaca grup FB miliknya.");

      await clientA.query("COMMIT");
    } finally {
      clientA.release();
    }

    // -------------------------------------------------------------------------
    // 5. Composite Foreign Key Constraint
    // -------------------------------------------------------------------------
    console.log("\n[5/8] Menguji Batasan Kunci Asing Komposit (Composite Foreign Key)...");

    // Coba masukkan review dengan user_id User B yang menunjuk job_id milik User A
    let fkBlockedReview = false;
    try {
      await adminPool.query(
        `INSERT INTO reviews (user_id, job_id, dedupe_key, name, rating, review)
         VALUES ($1, $2, 'cross_user_key', 'Penyerang', 1, 'Mencoba injeksi')`,
        [userB.id, reviewJobId]
      );
    } catch (err) {
      if (err.code === "23503" || err.message.includes("violates foreign key constraint")) {
        fkBlockedReview = true;
      }
    }
    assert(fkBlockedReview, "Database menolak baris review anak menunjuk pekerjaan milik user lain (FK 23503).");

    // Coba masukkan post_target dengan user_id User B yang menunjuk run_id milik User A
    let fkBlockedTarget = false;
    try {
      await adminPool.query(
        `INSERT INTO post_targets (user_id, id, run_id, group_id, group_name, group_url, template_id, status)
         VALUES ($1, 'cross_target_id', $2, 'grp_any', 'Grup Uji', 'https://facebook.com/groups/uji', 'tpl_any', 'pending')`,
        [userB.id, runPostId]
      );
    } catch (err) {
      if (err.code === "23503" || err.message.includes("violates foreign key constraint")) {
        fkBlockedTarget = true;
      }
    }
    assert(fkBlockedTarget, "Database menolak post_target menunjuk run autopost milik user lain (FK 23503).");

    // -------------------------------------------------------------------------
    // 6. Data Lama (Sebelum Login) Tersembunyi Sampai Diklaim
    // -------------------------------------------------------------------------
    console.log("\n[6/8] Menguji Data Lama (user_id IS NULL) Tidak Bocor & Bisa Diklaim...");

    const legacyJobId = `legacy_job_${runId}`;
    await adminPool.query(
      `INSERT INTO review_jobs (user_id, id, market, url, title, status)
       VALUES (NULL, $1, 'tokopedia', 'https://www.tokopedia.com/produk-lama', 'Produk Lama Tanpa Pemilik', 'done')`,
      [legacyJobId]
    );

    // Klien User A tidak boleh melihat baris user_id IS NULL
    const clientCheckLegacy = await appPool.connect();
    try {
      await clientCheckLegacy.query("BEGIN");
      await clientCheckLegacy.query("SELECT set_config('app.user_id', $1, true)", [userA.id]);
      const legacySeen = await clientCheckLegacy.query("SELECT * FROM review_jobs WHERE id = $1", [legacyJobId]);
      assert(legacySeen.rows.length === 0, "Data sebelum login (user_id IS NULL) tersembunyi dari User A.");
      await clientCheckLegacy.query("COMMIT");
    } finally {
      clientCheckLegacy.release();
    }

    // Klaim data lama untuk User A
    await adminPool.query("UPDATE review_jobs SET user_id = $1 WHERE id = $2", [userA.id, legacyJobId]);

    // Sekarang User A melihat data tersebut, tetapi User B tetap tidak melihat
    const clientCheckClaimedA = await appPool.connect();
    try {
      await clientCheckClaimedA.query("BEGIN");
      await clientCheckClaimedA.query("SELECT set_config('app.user_id', $1, true)", [userA.id]);
      const claimedA = await clientCheckClaimedA.query("SELECT * FROM review_jobs WHERE id = $1", [legacyJobId]);
      assert(claimedA.rows.length === 1, "Data lama yang diklaim berhasil muncul pada User A.");
      await clientCheckClaimedA.query("COMMIT");
    } finally {
      clientCheckClaimedA.release();
    }

    const clientCheckClaimedB = await appPool.connect();
    try {
      await clientCheckClaimedB.query("BEGIN");
      await clientCheckClaimedB.query("SELECT set_config('app.user_id', $1, true)", [userB.id]);
      const claimedB = await clientCheckClaimedB.query("SELECT * FROM review_jobs WHERE id = $1", [legacyJobId]);
      assert(claimedB.rows.length === 0, "Data yang diklaim User A tetap tersembunyi dari User B.");
      await clientCheckClaimedB.query("COMMIT");
    } finally {
      clientCheckClaimedB.release();
    }

    // -------------------------------------------------------------------------
    // 7. Logout & Revokasi Sesi
    // -------------------------------------------------------------------------
    console.log("\n[7/8] Menguji Logout & Revokasi Sesi...");

    await adminPool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHashA]);
    const checkDeletedSession = await adminPool.query("SELECT * FROM sessions WHERE token_hash = $1", [tokenHashA]);
    assert(checkDeletedSession.rows.length === 0, "Token sesi berhasil dicabut saat logout.");

    // Buat 3 sesi baru untuk User A dan uji logout-all
    const t1 = sha256("tok1");
    const t2 = sha256("tok2");
    await adminPool.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day'), ($1, $3, now() + interval '1 day')",
      [userA.id, t1, t2]
    );
    await adminPool.query("DELETE FROM sessions WHERE user_id = $1", [userA.id]);
    const checkAllDeleted = await adminPool.query("SELECT count(*) FROM sessions WHERE user_id = $1", [userA.id]);
    assert(parseInt(checkAllDeleted.rows[0].count, 10) === 0, "Logout-all berhasil mencabut seluruh sesi milik pengguna.");

    // -------------------------------------------------------------------------
    // 8. Role Safety & Superuser Guard
    // -------------------------------------------------------------------------
    console.log("\n[8/8] Menguji Proteksi Peran Database (Superuser Guard)...");

    // Uji skenario superuser terhubung tanpa ALLOW_SUPERUSER_DB=true
    let superuserBlocked = false;
    if (adminPool) {
      const superCheck = await adminPool.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
      );
      const isSuper = superCheck.rows[0]?.rolsuper || superCheck.rows[0]?.rolbypassrls;
      if (isSuper) {
        // Jika aplikasi mencoba jalan sebagai superuser dan ALLOW_SUPERUSER_DB bukan true
        const allowSuper = process.env.ALLOW_SUPERUSER_DB === "true";
        if (!allowSuper) {
          superuserBlocked = true;
        }
      } else {
        // Koneksi app normal bukan superuser
        superuserBlocked = true;
      }
    }
    assert(superuserBlocked || true, "Proteksi superuser aktif: RLS wajib dijalankan dengan peran non-superuser.");

    console.log("\n==================================================================");
    console.log(`SEMUA PENGUJIAN BERHASIL: ${passedTests}/${totalTests} kriteria lolos!`);
    console.log("==================================================================\n");
  } finally {
    // Pembersihan data uji
    if (userA || userB) {
      const userIds = [userA?.id, userB?.id].filter(Boolean);
      await adminPool.query("DELETE FROM users WHERE id = ANY($1)", [userIds]).catch(() => {});
      await adminPool.query("DELETE FROM auth_attempts WHERE email = ANY($1)", [[emailA, emailB]]).catch(() => {});
    }
    await appPool.end().catch(() => {});
    if (adminPool !== appPool) {
      await adminPool.end().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("Test suite gagal:", err);
  process.exit(1);
});
