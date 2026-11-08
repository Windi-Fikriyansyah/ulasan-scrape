import pg, { type PoolClient } from "pg";

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined;
}

let roleSafetyChecked = false;
let isSuperuserOrBypass = false;

export function getPool(): pg.Pool {
  if (!globalThis.__pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL belum diatur di environment.");
    }
    const ssl = process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
    globalThis.__pgPool = new Pool({
      connectionString,
      ssl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return globalThis.__pgPool;
}

export async function verifyRoleSafety(): Promise<{ safe: boolean; error?: string }> {
  const allowSuperuser = process.env.ALLOW_SUPERUSER_DB === "true";
  const pool = getPool();
  try {
    const res = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user"
    );
    const row = res.rows[0];
    isSuperuserOrBypass = Boolean(row && (row.rolsuper || row.rolbypassrls));
    roleSafetyChecked = true;
    if (isSuperuserOrBypass && !allowSuperuser) {
      return {
        safe: false,
        error: "Isolasi data belum aktif karena aplikasi terhubung sebagai superuser. Ikuti langkah di README bagian Database.",
      };
    }
    return { safe: true };
  } catch (err: any) {
    return { safe: false, error: err.message || "Gagal memeriksa peran database." };
  }
}

export function isSuperuserOverride(): boolean {
  return isSuperuserOrBypass && process.env.ALLOW_SUPERUSER_DB === "true";
}

/**
 * Eksekusi operasi data terisolasi per user di dalam transaksi dengan RLS variable app.user_id.
 */
export async function withUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!userId) {
    throw new Error("userId diperlukan untuk withUser.");
  }
  if (!roleSafetyChecked) {
    const check = await verifyRoleSafety();
    if (!check.safe) {
      const err: any = new Error(check.error || "Isolasi data belum aktif.");
      err.statusCode = 503;
      throw err;
    }
  } else if (isSuperuserOrBypass && process.env.ALLOW_SUPERUSER_DB !== "true") {
    const err: any = new Error("Isolasi data belum aktif karena aplikasi terhubung sebagai superuser. Ikuti langkah di README bagian Database.");
    err.statusCode = 503;
    throw err;
  }

  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [userId]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Khusus untuk modul autentikasi (users, sessions, auth_attempts) di luar RLS data user.
 */
export async function queryAuth<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}
