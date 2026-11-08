import { NextResponse, type NextRequest } from "next/server";
import { withAuth, dedupeKeyLead } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { Lead } from "@/lib/types";

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

    const success = await withUser(user.id, async (client) => {
      // Pastikan job ada dan milik user ini
      const jobCheck = await client.query("SELECT id FROM lead_jobs WHERE id = $1 AND user_id = $2", [
        jobId,
        user.id,
      ]);
      if (jobCheck.rows.length === 0) {
        return false;
      }

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
          const rating =
            typeof l.rating === "number" && Number.isFinite(l.rating)
              ? Math.max(0, Math.min(5, l.rating))
              : null;
          const reviewsCount =
            typeof l.reviews === "number" && Number.isFinite(l.reviews)
              ? Math.max(0, Math.round(l.reviews))
              : null;
          const hours = l.hours ? String(l.hours).slice(0, 2000) : null;
          const lat = typeof l.lat === "number" && Number.isFinite(l.lat) ? l.lat : null;
          const lng = typeof l.lng === "number" && Number.isFinite(l.lng) ? l.lng : null;
          const mapsUrl = l.mapsUrl ? String(l.mapsUrl).slice(0, 2000) : null;
          const status = l.status ? String(l.status).slice(0, 200) : null;

          valuePlaceholders.push(
            `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
          );
          rows.push(
            user.id,
            jobId,
            dedupeKey,
            name,
            category,
            address,
            phone,
            website,
            rating,
            reviewsCount,
            hours,
            lat,
            lng,
            mapsUrl,
            status
          );
        }

        const sql = `
          INSERT INTO leads (
            user_id, job_id, dedupe_key, name, category, address, phone, website, rating, reviews_count, hours, lat, lng, maps_url, status
          )
          VALUES ${valuePlaceholders.join(", ")}
          ON CONFLICT (user_id, job_id, dedupe_key) DO NOTHING;
        `;

        await client.query(sql, rows);
      }

      if (typeof found === "number" && Number.isFinite(found)) {
        await client.query("UPDATE lead_jobs SET found = $1 WHERE id = $2 AND user_id = $3", [
          Math.max(0, found),
          jobId,
          user.id,
        ]);
      }

      return true;
    });

    if (!success) {
      return NextResponse.json({ ok: false, error: "Pekerjaan lead maps tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, count: leads.length });
  });
}
