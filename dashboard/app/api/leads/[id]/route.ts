import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { LeadJob } from "@/lib/types";

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
          lj.id,
          lj.keyword,
          lj.location,
          lj.url,
          lj.fields,
          lj.max_results AS "maxResults",
          lj.status,
          lj.error,
          lj.found,
          lj.sample,
          extract(epoch from lj.started_at) * 1000 AS "startedAt",
          extract(epoch from lj.finished_at) * 1000 AS "finishedAt",
          COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'name', l.name,
                  'category', l.category,
                  'address', l.address,
                  'phone', l.phone,
                  'website', l.website,
                  'rating', l.rating,
                  'reviews', l.reviews_count,
                  'hours', l.hours,
                  'lat', l.lat,
                  'lng', l.lng,
                  'mapsUrl', l.maps_url,
                  'status', l.status
                ) ORDER BY l.id ASC
              )
              FROM leads l
              WHERE l.job_id = lj.id AND l.user_id = lj.user_id
            ),
            '[]'::json
          ) AS leads
        FROM lead_jobs lj
        WHERE lj.id = $1 AND lj.user_id = $2;
      `,
        [id, user.id]
      );

      if (res.rows.length === 0) {
        return null;
      }

      const row = res.rows[0];
      return {
        id: row.id,
        keyword: row.keyword || "",
        location: row.location || "",
        url: row.url,
        fields: Array.isArray(row.fields) ? row.fields : [],
        maxResults: Number(row.maxResults) || 50,
        status: row.status,
        error: row.error || undefined,
        found: Number(row.found) || 0,
        sample: row.sample || undefined,
        startedAt: Math.round(Number(row.startedAt)),
        finishedAt: row.finishedAt ? Math.round(Number(row.finishedAt)) : undefined,
        leads: Array.isArray(row.leads)
          ? row.leads.map((l: any) => ({
              ...l,
              category: l.category || undefined,
              address: l.address || undefined,
              phone: l.phone || undefined,
              website: l.website || undefined,
              rating: typeof l.rating === "number" || typeof l.rating === "string" ? Number(l.rating) : undefined,
              reviews: typeof l.reviews === "number" ? l.reviews : undefined,
              hours: l.hours || undefined,
              lat: typeof l.lat === "number" ? l.lat : undefined,
              lng: typeof l.lng === "number" ? l.lng : undefined,
              mapsUrl: l.mapsUrl || undefined,
              status: l.status || undefined,
            }))
          : [],
      } as LeadJob;
    });

    if (!job) {
      return NextResponse.json({ ok: false, error: "Pekerjaan lead maps tidak ditemukan." }, { status: 404 });
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
    if (body.found !== undefined) {
      updates.push(`found = $${idx++}`);
      values.push(Math.max(0, Number(body.found) || 0));
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
          `UPDATE lead_jobs SET ${updates.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING id`,
          values
        );
        return res.rows.length > 0;
      }
      const check = await client.query("SELECT id FROM lead_jobs WHERE id = $1 AND user_id = $2", [id, user.id]);
      return check.rows.length > 0;
    });

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Pekerjaan lead maps tidak ditemukan." }, { status: 404 });
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
      const res = await client.query("DELETE FROM lead_jobs WHERE id = $1 AND user_id = $2 RETURNING id", [
        id,
        user.id,
      ]);
      return res.rows.length > 0;
    });

    if (!deleted) {
      return NextResponse.json({ ok: false, error: "Pekerjaan lead maps tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
