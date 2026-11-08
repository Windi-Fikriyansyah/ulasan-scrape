import { NextResponse, type NextRequest } from "next/server";
import { withAuth, dedupeKeyReview } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { Review } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Context) {
  return withAuth(req, async (user) => {
    const { id: jobId } = await params;
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const reviews: Review[] = body.reviews;
    const page: number | undefined = body.page;

    if (!Array.isArray(reviews)) {
      return NextResponse.json({ ok: false, error: "Data ulasan harus berupa array." }, { status: 400 });
    }
    if (reviews.length > 500) {
      return NextResponse.json(
        { ok: false, error: "Ukuran batch ulasan melebihi batas maksimal 500 item." },
        { status: 400 }
      );
    }

    const success = await withUser(user.id, async (client) => {
      // Pastikan job ada dan milik user ini
      const jobCheck = await client.query(
        "SELECT id FROM review_jobs WHERE id = $1 AND user_id = $2",
        [jobId, user.id]
      );
      if (jobCheck.rows.length === 0) {
        return false;
      }

      if (reviews.length > 0) {
        const rows: any[] = [];
        const valuePlaceholders: string[] = [];
        let pIdx = 1;

        for (const r of reviews) {
          const dedupeKey = dedupeKeyReview(r);
          const name = String(r.name || "").slice(0, 300);
          const avatar = String(r.avatar || "").slice(0, 2000);
          const rating = Math.max(0, Math.min(5, Math.round(Number(r.rating) || 0)));
          const dateText = String(r.date || "").slice(0, 100);
          const variant = String(r.variant || "").slice(0, 300);
          const reviewText = String(r.review || "").slice(0, 20000);
          const imagesJson = JSON.stringify(
            Array.isArray(r.images) ? r.images.map((s) => String(s).slice(0, 2000)) : []
          );
          const sellerReply = String(r.seller_reply || "").slice(0, 10000);

          valuePlaceholders.push(
            `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
          );
          rows.push(
            user.id,
            jobId,
            dedupeKey,
            name,
            avatar,
            rating,
            dateText,
            variant,
            reviewText,
            imagesJson,
            sellerReply
          );
        }

        const sql = `
          INSERT INTO reviews (
            user_id, job_id, dedupe_key, name, avatar, rating, date_text, variant, review, images, seller_reply
          )
          VALUES ${valuePlaceholders.join(", ")}
          ON CONFLICT (user_id, job_id, dedupe_key) DO NOTHING;
        `;

        await client.query(sql, rows);
      }

      if (typeof page === "number" && Number.isFinite(page)) {
        await client.query("UPDATE review_jobs SET page = $1 WHERE id = $2 AND user_id = $3", [
          Math.max(0, page),
          jobId,
          user.id,
        ]);
      }

      return true;
    });

    if (!success) {
      return NextResponse.json({ ok: false, error: "Pekerjaan ulasan tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, count: reviews.length });
  });
}
