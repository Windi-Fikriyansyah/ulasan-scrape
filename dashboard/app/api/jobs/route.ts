import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(req, async (user) => {
    const jobs = await withUser(user.id, async (client) => {
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
        WHERE rj.user_id = $1
        ORDER BY rj.started_at DESC;
      `,
        [user.id]
      );

      return res.rows.map((row) => ({
        id: row.id,
        market: row.market,
        url: row.url,
        title: row.title || "",
        image: row.image || undefined,
        sample: row.sample || undefined,
        status: row.status === "running" ? "stopped" : row.status,
        error: row.error || undefined,
        page: Number(row.page) || 0,
        maxPages: Number(row.maxPages) || 10,
        startedAt: Math.round(Number(row.startedAt)),
        finishedAt: row.finishedAt ? Math.round(Number(row.finishedAt)) : undefined,
        reviews: Array.isArray(row.reviews) ? row.reviews : [],
      }));
    });

    return NextResponse.json({ ok: true, jobs });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (user) => {
    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
    }

    const { id, market, url, title, image, sample, status, error, page, maxPages, startedAt, finishedAt } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ ok: false, error: "ID pekerjaan wajib diisi." }, { status: 400 });
    }
    if (!url || typeof url !== "string") {
      return NextResponse.json({ ok: false, error: "URL pekerjaan wajib diisi." }, { status: 400 });
    }

    const mkt = ["tokopedia", "shopee", "lazada"].includes(market) ? market : "tokopedia";
    const st = ["running", "done", "stopped", "error"].includes(status) ? status : "running";
    const started = Number(startedAt) || Date.now();
    const finished = finishedAt ? Number(finishedAt) : null;

    await withUser(user.id, async (client) => {
      await client.query(
        `
        INSERT INTO review_jobs (
          user_id, id, market, url, title, image, sample, status, error, page, max_pages, started_at, finished_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          to_timestamp($12 / 1000.0),
          CASE WHEN $13::bigint IS NOT NULL THEN to_timestamp($13 / 1000.0) ELSE NULL END
        )
        ON CONFLICT (user_id, id) DO UPDATE SET
          market = EXCLUDED.market,
          url = EXCLUDED.url,
          title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE review_jobs.title END,
          image = COALESCE(EXCLUDED.image, review_jobs.image),
          sample = COALESCE(EXCLUDED.sample, review_jobs.sample),
          status = EXCLUDED.status,
          error = EXCLUDED.error,
          page = EXCLUDED.page,
          max_pages = EXCLUDED.max_pages,
          finished_at = COALESCE(EXCLUDED.finished_at, review_jobs.finished_at)
      `,
        [
          user.id,
          id.slice(0, 100),
          mkt,
          url.slice(0, 2000),
          (title || "").slice(0, 500),
          image ? String(image).slice(0, 2000) : null,
          sample ? String(sample).slice(0, 50000) : null,
          st,
          error ? String(error).slice(0, 1000) : null,
          Math.max(0, Number(page) || 0),
          Math.max(1, Number(maxPages) || 10),
          started,
          finished,
        ]
      );
    });

    return NextResponse.json({ ok: true, id });
  });
}
