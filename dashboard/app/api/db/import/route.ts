import { NextResponse, type NextRequest } from "next/server";
import { checkGuard, dedupeKeyLead, dedupeKeyReview } from "@/lib/server/guard";
import { getPool } from "@/lib/server/pg";
import type { Job, LeadJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const jobs: Job[] = Array.isArray(body.jobs) ? body.jobs : [];
    const leadJobs: LeadJob[] = Array.isArray(body.leadJobs) ? body.leadJobs : [];

    if (jobs.length === 0 && leadJobs.length === 0) {
      return NextResponse.json({ ok: false, error: "Tidak ada data untuk diimpor." }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();

    let importedJobs = 0;
    let importedReviews = 0;
    let importedLeadJobs = 0;
    let importedLeads = 0;

    try {
      await client.query("BEGIN");

      // 1. Impor review jobs dan reviews
      for (const j of jobs) {
        if (!j.id || !j.url) continue;

        const mkt = ["tokopedia", "shopee", "lazada"].includes(j.market || "") ? j.market : "tokopedia";
        const st = ["running", "done", "stopped", "error"].includes(j.status) ? (j.status === "running" ? "stopped" : j.status) : "stopped";

        await client.query(
          `
          INSERT INTO review_jobs (
            id, market, url, title, image, sample, status, error, page, max_pages, started_at, finished_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            to_timestamp($11 / 1000.0),
            CASE WHEN $12::bigint IS NOT NULL THEN to_timestamp($12 / 1000.0) ELSE NULL END
          )
          ON CONFLICT (id) DO NOTHING;
        `,
          [
            j.id.slice(0, 100),
            mkt,
            j.url.slice(0, 2000),
            (j.title || "").slice(0, 500),
            j.image ? String(j.image).slice(0, 2000) : null,
            j.sample ? String(j.sample).slice(0, 50000) : null,
            st,
            j.error ? String(j.error).slice(0, 1000) : null,
            Math.max(0, Number(j.page) || 0),
            Math.max(1, Number(j.maxPages) || 10),
            Number(j.startedAt) || Date.now(),
            j.finishedAt ? Number(j.finishedAt) : null,
          ]
        );
        importedJobs++;

        // Masukkan reviews per 200 baris
        if (Array.isArray(j.reviews) && j.reviews.length > 0) {
          const CHUNK = 200;
          for (let i = 0; i < j.reviews.length; i += CHUNK) {
            const chunk = j.reviews.slice(i, i + CHUNK);
            const rows: any[] = [];
            const valuePlaceholders: string[] = [];
            let pIdx = 1;

            for (const r of chunk) {
              const dedupeKey = dedupeKeyReview(r);
              const name = String(r.name || "").slice(0, 300);
              const avatar = String(r.avatar || "").slice(0, 2000);
              const rating = Math.max(0, Math.min(5, Math.round(Number(r.rating) || 0)));
              const dateText = String(r.date || "").slice(0, 100);
              const variant = String(r.variant || "").slice(0, 300);
              const reviewText = String(r.review || "").slice(0, 20000);
              const imagesJson = JSON.stringify(Array.isArray(r.images) ? r.images.map((s) => String(s).slice(0, 2000)) : []);
              const sellerReply = String(r.seller_reply || "").slice(0, 10000);

              valuePlaceholders.push(
                `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
              );
              rows.push(j.id, dedupeKey, name, avatar, rating, dateText, variant, reviewText, imagesJson, sellerReply);
            }

            const sql = `
              INSERT INTO reviews (
                job_id, dedupe_key, name, avatar, rating, date_text, variant, review, images, seller_reply
              )
              VALUES ${valuePlaceholders.join(", ")}
              ON CONFLICT (job_id, dedupe_key) DO NOTHING;
            `;

            await client.query(sql, rows);
            importedReviews += chunk.length;
          }
        }
      }

      // 2. Impor lead jobs dan leads
      for (const lj of leadJobs) {
        if (!lj.id || !lj.url) continue;

        const st = ["running", "done", "stopped", "error"].includes(lj.status) ? (lj.status === "running" ? "stopped" : lj.status) : "stopped";
        const flds = Array.isArray(lj.fields) ? lj.fields.map((s) => String(s).slice(0, 50)) : [];

        await client.query(
          `
          INSERT INTO lead_jobs (
            id, keyword, location, url, fields, max_results, status, error, found, sample, started_at, finished_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            to_timestamp($11 / 1000.0),
            CASE WHEN $12::bigint IS NOT NULL THEN to_timestamp($12 / 1000.0) ELSE NULL END
          )
          ON CONFLICT (id) DO NOTHING;
        `,
          [
            lj.id.slice(0, 100),
            (lj.keyword || "").slice(0, 300),
            (lj.location || "").slice(0, 300),
            lj.url.slice(0, 2000),
            flds,
            Math.max(1, Number(lj.maxResults) || 50),
            st,
            lj.error ? String(lj.error).slice(0, 1000) : null,
            Math.max(0, Number(lj.found) || 0),
            lj.sample ? String(lj.sample).slice(0, 50000) : null,
            Number(lj.startedAt) || Date.now(),
            lj.finishedAt ? Number(lj.finishedAt) : null,
          ]
        );
        importedLeadJobs++;

        // Masukkan leads per 200 baris
        if (Array.isArray(lj.leads) && lj.leads.length > 0) {
          const CHUNK = 200;
          for (let i = 0; i < lj.leads.length; i += CHUNK) {
            const chunk = lj.leads.slice(i, i + CHUNK);
            const rows: any[] = [];
            const valuePlaceholders: string[] = [];
            let pIdx = 1;

            for (const l of chunk) {
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
              rows.push(lj.id, dedupeKey, name, category, address, phone, website, rating, reviewsCount, hours, lat, lng, mapsUrl, status);
            }

            const sql = `
              INSERT INTO leads (
                job_id, dedupe_key, name, category, address, phone, website, rating, reviews_count, hours, lat, lng, maps_url, status
              )
              VALUES ${valuePlaceholders.join(", ")}
              ON CONFLICT (job_id, dedupe_key) DO NOTHING;
            `;

            await client.query(sql, rows);
            importedLeads += chunk.length;
          }
        }
      }

      await client.query("COMMIT");

      return NextResponse.json({
        ok: true,
        importedJobs,
        importedReviews,
        importedLeadJobs,
        importedLeads,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal mengimpor data ke PostgreSQL: ${err.message}` },
      { status: 500 }
    );
  }
}

