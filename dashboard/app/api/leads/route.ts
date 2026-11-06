import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import type { LeadJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const res = await query(`
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
      GROUP BY lj.id
      ORDER BY lj.started_at DESC;
    `);

    const jobs: LeadJob[] = res.rows.map((row) => ({
      id: row.id,
      keyword: row.keyword || "",
      location: row.location || "",
      url: row.url,
      fields: Array.isArray(row.fields) ? row.fields : [],
      maxResults: Number(row.maxResults) || 50,
      status: row.status === "running" ? "stopped" : row.status,
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
    }));

    return NextResponse.json({ ok: true, jobs });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal membaca riwayat lead maps dari database: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { id, keyword, location, url, fields, maxResults, status, error, found, sample, startedAt, finishedAt } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ ok: false, error: "ID pekerjaan wajib diisi." }, { status: 400 });
    }
    if (!url || typeof url !== "string") {
      return NextResponse.json({ ok: false, error: "URL wajib diisi." }, { status: 400 });
    }

    const st = ["running", "done", "stopped", "error"].includes(status) ? status : "running";
    const started = Number(startedAt) || Date.now();
    const finished = finishedAt ? Number(finishedAt) : null;
    const flds = Array.isArray(fields) ? fields.map((s) => String(s).slice(0, 50)) : [];

    await query(
      `
      INSERT INTO lead_jobs (
        id, keyword, location, url, fields, max_results, status, error, found, sample, started_at, finished_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        to_timestamp($11 / 1000.0),
        CASE WHEN $12::bigint IS NOT NULL THEN to_timestamp($12 / 1000.0) ELSE NULL END
      )
      ON CONFLICT (id) DO UPDATE SET
        keyword = EXCLUDED.keyword,
        location = EXCLUDED.location,
        url = EXCLUDED.url,
        fields = EXCLUDED.fields,
        max_results = EXCLUDED.max_results,
        status = EXCLUDED.status,
        error = EXCLUDED.error,
        found = EXCLUDED.found,
        sample = COALESCE(EXCLUDED.sample, lead_jobs.sample),
        finished_at = COALESCE(EXCLUDED.finished_at, lead_jobs.finished_at)
    `,
      [
        id.slice(0, 100),
        (keyword || "").slice(0, 300),
        (location || "").slice(0, 300),
        url.slice(0, 2000),
        flds,
        Math.max(1, Number(maxResults) || 50),
        st,
        error ? String(error).slice(0, 1000) : null,
        Math.max(0, Number(found) || 0),
        sample ? String(sample).slice(0, 50000) : null,
        started,
        finished,
      ]
    );

    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal menyimpan pekerjaan lead maps: ${err.message}` },
      { status: 500 }
    );
  }
}

