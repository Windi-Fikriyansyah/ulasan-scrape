import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { queryAuth } from "@/lib/server/pg";
import { verifyPassword, SESSION_COOKIE_NAME } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  return withAuth(req, async (user) => {
    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const password = body.password || "";
    if (!password) {
      return NextResponse.json(
        { ok: false, error: "Konfirmasi kata sandi wajib diisi." },
        { status: 400 }
      );
    }

    const userRes = await queryAuth<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [user.id]
    );
    const stored = userRes.rows[0];
    if (!stored) {
      return NextResponse.json({ ok: false, error: "User tidak ditemukan." }, { status: 404 });
    }

    const matches = await verifyPassword(password, stored.password_hash);
    if (!matches) {
      return NextResponse.json(
        { ok: false, error: "Kata sandi salah." },
        { status: 400 }
      );
    }

    // ON DELETE CASCADE pada semua relasi akan menghapus review_jobs, lead_jobs, fb_groups, post_templates, post_runs, sessions
    await queryAuth("DELETE FROM users WHERE id = $1", [user.id]);

    const res = NextResponse.json({ ok: true, message: "Akun berhasil dihapus." });
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

