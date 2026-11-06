import { NextResponse, type NextRequest } from "next/server";
import { checkGuard, dedupeKeyLead } from "@/lib/server/guard";
import { getPool } from "@/lib/server/pg";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Context) {
  const guard = checkGuard(req);
  if (guard) return guard;

  const { id: jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "ID pekerjaan tidak valid." }, { status: 400 });
  }

  try {
    const body = await req.json();
    const leads: Lead[] = body.leads;
    const found: number | undefined = body.found;

    if (!Array.isArray(leads)) {
      return NextResponse.json({ ok: false, error: "Data lead harus berupa array." }, { status: 400 });
    }
    if (leads.length > 500) {
      return NextResponse.json(
        { ok: false, error: "Ukuran batch lead melebihi batas maksimal 500 item." },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (leads.length > 0) {
        const rows: any[] = [];
        const valuePlaceholders: string[] = [];
        let pIdx = 1;

        for (const l of leads) {
          const dedupeKey = dedupeKeyLead(l);
          const name = String(l.name || "Tempat Usaha").slice(0, 300);
          const category = l.category ? String(l.category).slice(0, 200) : null;
          const address = l.address ? String(l.address).slice(0, 1000) : null;
          const phone = l.phone ? String(l.phone).slice(0, 100) : null;
          const website = l.website ? String(l.website).slice(0, 2000) : null;
          const rating = typeof l.rating === "number" && Number.isFinite(l.rating) ? Math.max(0, Math.min(5, l.rating)) : null;
          const reviewsCount = typeof l.reviews === "number" && Number.isFinite(l.reviews) ? Math.max(0, Math.round(l.reviews)) : null;
          const hours = l.hours ? String(l.hours).slice(0, 2000) : null;
          const lat = typeof l.lat === "number" && Number.isFinite(l.lat) ? l.lat : null;
          const lng = typeof l.lng === "number" && Number.isFinite(l.lng) ? l.lng : null;
          const mapsUrl = l.mapsUrl ? String(l.mapsUrl).slice(0, 2000) : null;
          const status = l.status ? String(l.status).slice(0, 200) : null;

          valuePlaceholders.push(
            `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
          );
          rows.push(jobId, dedupeKey, name, category, address, phone, website, rating, reviewsCount, hours, lat, lng, mapsUrl, status);
        }

        const sql = `
          INSERT INTO leads (
            job_id, dedupe_key, name, category, address, phone, website, rating, reviews_count, hours, lat, lng, maps_url, status
          )
          VALUES ${valuePlaceholders.join(", ")}
          ON CONFLICT (job_id, dedupe_key) DO NOTHING;
        `;

        await client.query(sql, rows);
      }

      if (typeof found === "number" && Number.isFinite(found)) {
        await client.query("UPDATE lead_jobs SET found = $1 WHERE id = $2", [Math.max(0, found), jobId]);
      }

      await client.query("COMMIT");
      return NextResponse.json({ ok: true, count: leads.length });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal menyimpan batch lead: ${err.message}` },
      { status: 500 }
    );
  }
}

