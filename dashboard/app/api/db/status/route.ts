import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      return NextResponse.json({
        ok: false,
        error: "DATABASE_URL belum diatur di .env.local.",
      });
    }

    await query("SELECT 1");

    return NextResponse.json({
      ok: true,
      message: "Terhubung ke database PostgreSQL.",
    });
  } catch (err: any) {
    const code = err.code;
    let userMsg = err.message || "Gagal menyambung ke database.";
    if (code === "28P01") {
      userMsg = "Kata sandi PostgreSQL salah (28P01). Periksa DATABASE_URL di .env.local.";
    } else if (code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
      userMsg = "Server PostgreSQL tidak dapat dihubungi (ECONNREFUSED). Pastikan database sudah berjalan.";
    } else if (code === "3D000") {
      userMsg = 'Database belum dibuat (3D000). Jalankan "npm run db:setup" di folder dashboard.';
    }

    return NextResponse.json({
      ok: false,
      error: userMsg,
      code,
    });
  }
}

