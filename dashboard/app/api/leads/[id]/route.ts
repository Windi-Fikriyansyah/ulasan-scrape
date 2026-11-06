import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import type { LeadJob } from "@/lib/types";

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
          json_agg(
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
          ) FILTER (WHERE l.id IS NOT NULL),
          '[]'::json
        ) AS leads
      FROM lead_jobs lj
      LEFT JOIN leads l ON l.job_id = lj.id
      WHERE lj.id = $1
      GROUP BY lj.id;
    `,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Pekerjaan lead maps tidak ditemukan." }, { status: 404 });
    }

    const row = res.rows[0];
    const job: LeadJob = {
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
    };

    return NextResponse.json({ ok: true, job });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal membaca detail lead maps: ${err.message}` },
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

    if (updates.length > 0) {
      await query(`UPDATE lead_jobs SET ${updates.join(", ")} WHERE id = $1`, values);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal memperbarui pekerjaan lead maps: ${err.message}` },
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
    await query("DELETE FROM lead_jobs WHERE id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal menghapus pekerjaan lead maps: ${err.message}` },
      { status: 500 }
    );
  }
}

