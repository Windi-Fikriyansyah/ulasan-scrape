import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { queryAuth, verifyRoleSafety } from "@/lib/server/pg";
import {
  verifyPassword,
  performDummyPasswordCheck,
  createSession,
  checkRateLimit,
  recordAuthAttempt,
  getClientIp,
  SESSION_COOKIE_NAME,
} from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  const guardRes = checkGuard(req);
  if (guardRes) return guardRes;

  const roleCheck = await verifyRoleSafety();
  if (!roleCheck.safe) {
    return NextResponse.json({ ok: false, error: roleCheck.error }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const ip = getClientIp(req);

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email dan kata sandi wajib diisi." },
      { status: 400 }
    );
  }

  const rateLimit = await checkRateLimit(ip, email);
  if (rateLimit.blocked) {
    return NextResponse.json(
      { ok: false, error: rateLimit.message || "Terlalu banyak percobaan login. Silakan tunggu 15 menit." },
      { status: 429 }
    );
  }

  try {
    const userRes = await queryAuth<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string;
      disabled: boolean;
    }>(
      "SELECT id, email, display_name, password_hash, disabled FROM users WHERE lower(email) = $1",
      [email]
    );

    const user = userRes.rows[0];

    if (!user) {
      await performDummyPasswordCheck(password);
      await recordAuthAttempt(ip, email, false);
      return NextResponse.json(
        { ok: false, error: "Email atau kata sandi salah." },
        { status: 401 }
      );
    }

    if (user.disabled) {
      await performDummyPasswordCheck(password);
      await recordAuthAttempt(ip, email, false);
      return NextResponse.json(
        { ok: false, error: "Akun ini telah dinonaktifkan." },
        { status: 403 }
      );
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      await recordAuthAttempt(ip, email, false);
      return NextResponse.json(
        { ok: false, error: "Email atau kata sandi salah." },
        { status: 401 }
      );
    }

    await recordAuthAttempt(ip, email, true);
    await queryAuth("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);

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
    console.error("Login error:", err);
    return NextResponse.json(
      { ok: false, error: "Gagal memproses login." },
      { status: 500 }
    );
  }
}

