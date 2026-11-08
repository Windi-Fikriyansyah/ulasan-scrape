import { NextResponse, type NextRequest } from "next/server";
import { queryAuth } from "@/lib/server/pg";
import { hashToken, SESSION_COOKIE_NAME } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) {
    try {
      const tokenHash = hashToken(cookieToken);
      await queryAuth("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    } catch (_) {}
  }

  const res = NextResponse.json({ ok: true });
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
}

