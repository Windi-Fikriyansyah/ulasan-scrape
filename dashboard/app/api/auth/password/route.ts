import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { queryAuth } from "@/lib/server/pg";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  hashToken,
  SESSION_COOKIE_NAME,
} from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  return withAuth(req, async (user) => {
    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const oldPassword = body.oldPassword || body.old_password || "";
    const newPassword = body.newPassword || body.new_password || "";

    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { ok: false, error: "Kata sandi lama dan baru wajib diisi." },
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

    const matches = await verifyPassword(oldPassword, stored.password_hash);
    if (!matches) {
      return NextResponse.json(
        { ok: false, error: "Kata sandi lama salah." },
        { status: 400 }
      );
    }

    const passCheck = validatePassword(newPassword);
    if (!passCheck.valid) {
      return NextResponse.json({ ok: false, error: passCheck.reason }, { status: 400 });
    }

    const newHash = await hashPassword(newPassword);
    await queryAuth("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);

    // Cabut sesi lain kecuali sesi yang sedang aktif
    const currentToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (currentToken) {
      const currentHash = hashToken(currentToken);
      await queryAuth("DELETE FROM sessions WHERE user_id = $1 AND token_hash != $2", [
        user.id,
        currentHash,
      ]);
    } else {
      await queryAuth("DELETE FROM sessions WHERE user_id = $1", [user.id]);
    }

    return NextResponse.json({ ok: true, message: "Kata sandi berhasil diperbarui." });
  });
}

