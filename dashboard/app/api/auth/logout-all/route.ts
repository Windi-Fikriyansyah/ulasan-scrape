import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { queryAuth } from "@/lib/server/pg";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  return withAuth(req, async (user) => {
    await queryAuth("DELETE FROM sessions WHERE user_id = $1", [user.id]);

    const res = NextResponse.json({ ok: true, message: "Semua sesi berhasil dikeluarkan." });
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });

    return res;
  });
}

