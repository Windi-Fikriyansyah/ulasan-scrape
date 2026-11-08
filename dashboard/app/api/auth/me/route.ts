import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { isSuperuserOverride, verifyRoleSafety } from "@/lib/server/pg";

export async function GET(req: NextRequest) {
  const roleCheck = await verifyRoleSafety();
  if (!roleCheck.safe) {
    return NextResponse.json({ ok: false, error: roleCheck.error }, { status: 503 });
  }

  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Belum login." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
    superuserWarning: isSuperuserOverride(),
  });
}

