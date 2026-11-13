import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { queryAuth, verifyRoleSafety } from "@/lib/server/pg";
import { hashPassword, validateEmail } from "@/lib/server/auth";
import { sendWelcomeEmail } from "@/lib/server/email";

export const dynamic = "force-dynamic";

/**
 * Generate kata sandi acak yang mudah dibaca dan aman untuk pembeli baru
 * Contoh hasil: RL-7kX2-9pM4
 */
function generateRandomPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const part1 = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  const part2 = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `RL-${part1}-${part2}`;
}

export async function POST(req: NextRequest) {
  // 1. Verifikasi Keamanan Koneksi Database
  const roleCheck = await verifyRoleSafety();
  if (!roleCheck.safe) {
    return NextResponse.json({ ok: false, error: roleCheck.error }, { status: 503 });
  }

  // 2. Verifikasi API Secret Key dari Header
  const expectedKey = process.env.API_SECRET_KEY || process.env.WEBHOOK_SECRET || "reach-leads-secret-key-123";
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyHeader = req.headers.get("x-api-key") || "";

  let providedKey = "";
  if (authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7).trim();
  } else if (authHeader) {
    providedKey = authHeader.trim();
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader.trim();
  }

  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "Otorisasi ditolak. Masukkan API Key yang valid pada header Authorization: Bearer <API_SECRET_KEY> atau X-API-Key.",
      },
      { status: 401 }
    );
  }

  // 3. Baca Body Request JSON
  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return NextResponse.json({ ok: false, error: "Format request body harus berupa JSON." }, { status: 400 });
  }

  const rawEmail = String(body.email || "").trim().toLowerCase();
  const rawName = String(body.name || body.displayName || body.customer_name || "").trim();
  const shouldSendEmail = body.sendEmail !== false; // Default true

  // 4. Validasi Format Email
  if (!validateEmail(rawEmail)) {
    return NextResponse.json({ ok: false, error: "Alamat email pembeli tidak valid." }, { status: 400 });
  }

  // 5. Tentukan Password (Gunakan yang dikirim atau generate otomatis)
  const password = String(body.password || "").trim() || generateRandomPassword();
  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: "Password minimal 8 karakter." }, { status: 400 });
  }

  const displayName = (rawName || rawEmail.split("@")[0] || "Member").slice(0, 100);

  try {
    // 6. Periksa apakah user sudah terdaftar sebelumnya
    const existing = await queryAuth<{ id: string; email: string; display_name: string }>(
      "SELECT id, email, display_name FROM users WHERE lower(email) = $1",
      [rawEmail]
    );

    let userId: string;
    let isNewUser = true;

    if (existing.rows.length > 0) {
      isNewUser = false;
      const user = existing.rows[0];
      userId = user.id;

      // Jika ada instruksi resetPassword: true dari webhook, perbarui passwordnya
      if (body.resetPassword === true || body.updatePassword === true) {
        const passwordHash = await hashPassword(password);
        await queryAuth(
          "UPDATE users SET password_hash = $1, display_name = COALESCE(NULLIF($2, ''), display_name) WHERE id = $3",
          [passwordHash, displayName, userId]
        );
      }
    } else {
      // 7. Daftarkan Akun Baru di Database PostgreSQL
      const passwordHash = await hashPassword(password);
      const insertRes = await queryAuth<{ id: string; email: string; display_name: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name`,
        [rawEmail, displayName, passwordHash]
      );
      userId = insertRes.rows[0].id;
    }

    // 8. Tentukan URL Login Dashboard
    let appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL;
    if (!appUrl) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const proto = req.headers.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
      appUrl = `${proto}://${host}`;
    }
    const loginUrl = `${appUrl.replace(/\/+$/, "")}/login`;

    // 9. Kirim Email Selamat Datang & Kredensial ke Pembeli
    let emailResult = { success: false, provider: "none" as any };
    if (shouldSendEmail) {
      emailResult = await sendWelcomeEmail({
        name: displayName,
        email: rawEmail,
        password,
        loginUrl,
      });
    }

    // 10. Kembalikan Response Sukses ke Website Pemanggil
    return NextResponse.json({
      ok: true,
      message: isNewUser
        ? "Akun baru pembeli berhasil dibuat dan email kredensial telah diproses."
        : "Akun pembeli sudah terdaftar sebelumnya.",
      isNewUser,
      user: {
        id: userId,
        email: rawEmail,
        displayName,
      },
      credentials: {
        email: rawEmail,
        password,
        loginUrl,
      },
      emailDelivery: {
        sent: emailResult.success,
        provider: emailResult.provider,
      },
    });
  } catch (err: any) {
    console.error("[Webhook Create-User Error]:", err);
    return NextResponse.json(
      { ok: false, error: "Terjadi kesalahan pada server saat membuat akun: " + (err.message || String(err)) },
      { status: 500 }
    );
  }
}

