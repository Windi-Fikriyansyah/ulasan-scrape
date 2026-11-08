import { NextResponse } from "next/server";
import { queryAuth, verifyRoleSafety, isSuperuserOverride } from "@/lib/server/pg";

export async function GET() {
  try {
    const dbTest = await queryAuth("SELECT 1 as alive");
    const roleCheck = await verifyRoleSafety();

    return NextResponse.json({
      ok: true,
      status: "healthy",
      db: dbTest.rows.length > 0 ? "connected" : "unknown",
      role_safe: roleCheck.safe,
      superuser_warning: isSuperuserOverride(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        error: err.message || "Database tidak dapat dihubungi.",
      },
      { status: 503 }
    );
  }
}

