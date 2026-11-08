import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  return withAuth(req, async (user) => {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
    }

    const job = await withUser(user.id, async (client) => {
      const res = await client.query(
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
            (
              SELECT json_agg(
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
              )
              FROM reviews r
              WHERE r.job_id = rj.id AND r.user_id = rj.user_id
            ),
            '[]'::json
          ) AS reviews
        FROM review_jobs rj
        WHERE rj.id = $1 AND rj.user_id = $2;
      `,
        [id, user.id]
      );

      if (res.rows.length === 0) {
        return null;
      }

      const row = res.rows[0];
      return {
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
      } as Job;
    });

    if (!job) {
      return NextResponse.json({ ok: false, error: "Pekerjaan ulasan tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, job });
  });
}

export async function PATCH(req: NextRequest, { params }: Context) {
  return withAuth(req, async (user) => {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[] = [id, user.id];
    let idx = 3;

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
      updates.push(
        `finished_at = CASE WHEN $${idx++}::bigint IS NOT NULL THEN to_timestamp($${idx - 1} / 1000.0) ELSE NULL END`
      );
      values.push(body.finishedAt ? Number(body.finishedAt) : null);
    }

    const updated = await withUser(user.id, async (client) => {
      if (updates.length > 0) {
        const res = await client.query(
          `UPDATE review_jobs SET ${updates.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING id`,
          values
        );
        return res.rows.length > 0;
      }
      const check = await client.query("SELECT id FROM review_jobs WHERE id = $1 AND user_id = $2", [id, user.id]);
      return check.rows.length > 0;
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Pekerjaan ulasan tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest, { params }: Context) {
  return withAuth(req, async (user) => {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
    }

    const deleted = await withUser(user.id, async (client) => {
      const res = await client.query("DELETE FROM review_jobs WHERE id = $1 AND user_id = $2 RETURNING id", [
        id,
        user.id,
      ]);
      return res.rows.length > 0;
    });

    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Pekerjaan ulasan tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
