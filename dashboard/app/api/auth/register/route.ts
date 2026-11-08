import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { queryAuth, verifyRoleSafety } from "@/lib/server/pg";
import {
  hashPassword,
  validateEmail,
  validatePassword,
  createSession,
  SESSION_COOKIE_NAME,
} from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  const guardRes = checkGuard(req);
  if (guardRes) return guardRes;

  const roleCheck = await verifyRoleSafety();
  if (!roleCheck.safe) {
    return NextResponse.json({ ok: false, error: roleCheck.error }, { status: 503 });
  }

  if (process.env.ALLOW_REGISTRATION === "false") {
    return NextResponse.json(
      { ok: false, error: "Pendaftaran akun baru dinonaktifkan." },
      { status: 403 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const displayName = (body.displayName || body.display_name || email.split("@")[0] || "").trim().slice(0, 100);

  if (!validateEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Format email tidak valid." },
      { status: 400 }
    );
  }

  const passCheck = validatePassword(password);
  if (!passCheck.valid) {
    return NextResponse.json({ ok: false, error: passCheck.reason }, { status: 400 });
  }

  try {
    const existing = await queryAuth<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = $1",
      [email]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Email sudah terdaftar." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const insertRes = await queryAuth<{ id: string; email: string; display_name: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [email, displayName, passwordHash]
    );

    const user = insertRes.rows[0];
    const { token, expiresAt } = await createSession(user.id, req);

    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
      },
    });

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
      maxAge: 30 * 24 * 60 * 60,
    });

    return res;
  } catch (err: any) {
    console.error("Register error:", err);
    return NextResponse.json(
      { ok: false, error: "Gagal mendaftarkan akun." },
      { status: 500 }
    );
  }
}

