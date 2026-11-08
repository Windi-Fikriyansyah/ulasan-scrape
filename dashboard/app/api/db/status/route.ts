import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser, isSuperuserOverride } from "@/lib/server/pg";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(req, async (user) => {
    try {
      await withUser(user.id, async (client) => {
        await client.query("SELECT 1");
      });

      return NextResponse.json({
        ok: true,
        message: "Terhubung ke database PostgreSQL.",
        superuserWarning: isSuperuserOverride(),
      });
    } catch (err: any) {
      if (err?.statusCode === 503) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
      }
      return NextResponse.json(
        { ok: false, error: err.message || "Gagal menyambung ke database." },
        { status: 500 }
      );
    }
  });
}
