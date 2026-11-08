import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { getSessionUser, type AuthUser } from "./auth";
import { verifyRoleSafety } from "./pg";

export function checkGuard(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { ok: false, error: "Akses ditolak: Asal permintaan (Origin) tidak cocok dengan Host." },
          { status: 403 }
        );
      }
    } catch (_) {
      return NextResponse.json(
        { ok: false, error: "Akses ditolak: Header Origin tidak valid." },
        { status: 403 }
      );
    }
  }

  if (req.method !== "GET") {
    const clientHeader = req.headers.get("x-ulasan-client");
    if (clientHeader !== "1") {
      return NextResponse.json(
        { ok: false, error: "Akses ditolak: Header X-Ulasan-Client wajib diisi." },
        { status: 403 }
      );
    }
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { ok: false, error: "Format tidak valid: Content-Type harus application/json." },
        { status: 400 }
      );
    }
  }

  return null;
}

export async function withAuth(
  req: NextRequest,
  handler: (user: AuthUser) => Promise<NextResponse>
): Promise<NextResponse> {
  const guardRes = checkGuard(req);
  if (guardRes) return guardRes;

  const roleCheck = await verifyRoleSafety();
  if (!roleCheck.safe) {
    return NextResponse.json({ ok: false, error: roleCheck.error }, { status: 503 });
  }

  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sesi tidak valid atau telah berakhir." },
      { status: 401 }
    );
  }

  try {
    return await handler(user);
  } catch (err: any) {
    if (err?.statusCode === 503) {
      return NextResponse.json(
        { ok: false, error: err.message || "Layanan database tidak tersedia." },
        { status: 503 }
      );
    }
    // Pesan error umum ke klien tanpa membocorkan internal DB/stack trace
    console.error("API handler error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Terjadi kesalahan pada server." },
      { status: 500 }
    );
  }
}

export function sha1(str: string): string {
  return crypto.createHash("sha1").update(str, "utf8").digest("hex");
}

export function dedupeKeyReview(r: { name: string; date: string; rating: number; review: string }): string {
  const normName = (r.name || "").trim().toLowerCase();
  const date = (r.date || "").trim();
  const rating = Number(r.rating) || 0;
  const reviewSnippet = (r.review || "").trim().slice(0, 80);
  return sha1(`${normName}|${date}|${rating}|${reviewSnippet}`);
}

export function dedupeKeyLead(l: { mapsUrl?: string; name: string; address?: string }): string {
  if (l.mapsUrl) {
    const cleanUrl = l.mapsUrl.split("?")[0].split("#")[0].trim().toLowerCase();
    if (cleanUrl) return cleanUrl;
  }
  const normName = (l.name || "").trim().toLowerCase();
  const normAddr = (l.address || "").trim().toLowerCase();
  return sha1(`${normName}|${normAddr}`);
}
