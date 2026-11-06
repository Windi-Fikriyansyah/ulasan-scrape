import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
  }

  try {
    const res = await query(
      `
      SELECT 
        rj.id,
        rj.market,
        rj.url,
        rj.title,
        rj.image,
        rj.sample,
        rj.status,
        rj.error,
        rj.page,
        rj.max_pages AS "maxPages",
        extract(epoch from rj.started_at) * 1000 AS "startedAt",
        extract(epoch from rj.finished_at) * 1000 AS "finishedAt",
        COALESCE(
          json_agg(
            json_build_object(
              'name', r.name,
              'avatar', r.avatar,
              'rating', r.rating,
              'date', r.date_text,
              'variant', r.variant,
              'review', r.review,
              'images', r.images,
              'seller_reply', r.seller_reply
            ) ORDER BY r.id ASC
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::json
        ) AS reviews
      FROM review_jobs rj
      LEFT JOIN reviews r ON r.job_id = rj.id
      WHERE rj.id = $1
      GROUP BY rj.id;
    `,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Pekerjaan ulasan tidak ditemukan." }, { status: 404 });
    }

    const row = res.rows[0];
    const job: Job = {
      id: row.id,
      market: row.market,
      url: row.url,
      title: row.title || "",
      image: row.image || undefined,
      sample: row.sample || undefined,
      status: row.status,
      error: row.error || undefined,
      page: Number(row.page) || 0,
      maxPages: Number(row.maxPages) || 10,
      startedAt: Math.round(Number(row.startedAt)),
      finishedAt: row.finishedAt ? Math.round(Number(row.finishedAt)) : undefined,
      reviews: Array.isArray(row.reviews) ? row.reviews : [],
    };

    return NextResponse.json({ ok: true, job });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal membaca detail ulasan: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const updates: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (body.title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(String(body.title).slice(0, 500));
    }
    if (body.image !== undefined) {
      updates.push(`image = $${idx++}`);
      values.push(body.image ? String(body.image).slice(0, 2000) : null);
    }
    if (body.sample !== undefined) {
      updates.push(`sample = $${idx++}`);
      values.push(body.sample ? String(body.sample).slice(0, 50000) : null);
    }
    if (body.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(String(body.status));
    }
    if (body.error !== undefined) {
      updates.push(`error = $${idx++}`);
      values.push(body.error ? String(body.error).slice(0, 1000) : null);
    }
    if (body.page !== undefined) {
      updates.push(`page = $${idx++}`);
      values.push(Math.max(0, Number(body.page) || 0));
    }
    if (body.finishedAt !== undefined) {
      updates.push(`finished_at = CASE WHEN $${idx++}::bigint IS NOT NULL THEN to_timestamp($${idx - 1} / 1000.0) ELSE NULL END`);
      values.push(body.finishedAt ? Number(body.finishedAt) : null);
    }

    if (updates.length > 0) {
      await query(`UPDATE review_jobs SET ${updates.join(", ")} WHERE id = $1`, values);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal memperbarui pekerjaan ulasan: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
  }

  try {
    await query("DELETE FROM review_jobs WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal menghapus pekerjaan ulasan: ${err.message}` },
      { status: 500 }
    );
  }
}

