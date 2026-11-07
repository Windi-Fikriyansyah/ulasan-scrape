import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import { normalizeGroupUrl } from "@/lib/autopost";
import type { FbGroup } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const res = await query(`
      SELECT 
        id, 
        name, 
        url, 
        source,
        extract(epoch from created_at) * 1000 AS "createdAt"
      FROM fb_groups
      ORDER BY created_at DESC;
    `);

    const groups: FbGroup[] = res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      source: r.source as "auto" | "import" | "manual",
      createdAt: Math.round(Number(r.createdAt)),
    }));

    return NextResponse.json({ ok: true, groups });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const items: FbGroup[] = Array.isArray(body) ? body : body.groups || [];

    if (!items.length) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    // Deduplikasi items dalam satu request agar tidak ada tabrakan ID atau URL ganda
    const deduped: Array<{ id: string; name: string; url: string; source: string }> = [];
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();

    for (const g of items) {
      if (!g.url || !g.name) continue;
      const norm = normalizeGroupUrl(g.url);
      const cleanUrl = (norm ? norm.url : g.url).trim();
      const cleanId = (g.id || (norm ? norm.id : "") || "grp_" + Math.random().toString(36).slice(2, 10))
        .trim()
        .toLowerCase();
      const cleanName = g.name.trim();
      const source = g.source || "manual";
      const lowerUrl = cleanUrl.toLowerCase();

      if (seenIds.has(cleanId) || seenUrls.has(lowerUrl)) {
        continue;
      }
      seenIds.add(cleanId);
      seenUrls.add(lowerUrl);
      deduped.push({ id: cleanId, name: cleanName, url: cleanUrl, source });
    }

    let inserted = 0;
    for (const item of deduped) {
      try {
        // 1. Cek apakah sudah ada baris di database dengan ID atau URL yang sama
        const existing = await query<{ id: string; url: string }>(
          `SELECT id, url FROM fb_groups WHERE id = $1 OR lower(url) = lower($2) LIMIT 2`,
          [item.id, item.url]
        );

        if (existing.rows.length === 0) {
          // Belum ada sama sekali: INSERT baru
          try {
            await query(
              `
              INSERT INTO fb_groups (id, name, url, source, created_at)
              VALUES ($1, $2, $3, $4, now())
              ON CONFLICT (id) DO UPDATE
              SET name = EXCLUDED.name,
                  url = EXCLUDED.url,
                  source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE EXCLUDED.source END;
              `,
              [item.id, item.name, item.url, item.source]
            );
          } catch (insertErr: any) {
            // Jika ada tabrakan URL tak terduga (misal unique constraint url)
            if (insertErr.code === "23505" || insertErr.message?.includes("unique constraint")) {
              await query(
                `
                UPDATE fb_groups
                SET name = $1,
                    source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE $2 END
                WHERE lower(url) = lower($3) OR id = $4
                `,
                [item.name, item.source, item.url, item.id]
              );
            } else {
              throw insertErr;
            }
          }
        } else {
          // Sudah ada baris yang cocok berdasarkan ID atau URL
          const primaryId = existing.rows[0].id;

          // Jika ada lebih dari satu baris yang bentrok (misal satu cocok ID, satu cocok URL), hapus duplikat kedua
          if (existing.rows.length > 1) {
            const extraIds = existing.rows.slice(1).map((r) => r.id);
            await query(`DELETE FROM fb_groups WHERE id = ANY($1)`, [extraIds]);
          }

          await query(
            `
            UPDATE fb_groups
            SET name = $1,
                url = $2,
                source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE $3 END
            WHERE id = $4
            `,
            [item.name, item.url, item.source, primaryId]
          );
        }
        inserted++;
      } catch (itemErr: any) {
        // Fallback terakhir bila terjadi race condition concurrent insert
        if (itemErr.code === "23505" || itemErr.message?.includes("unique constraint")) {
          await query(
            `
            UPDATE fb_groups
            SET name = $1,
                source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE $2 END
            WHERE id = $3 OR lower(url) = lower($4)
            `,
            [item.name, item.source, item.id, item.url]
          ).catch(() => {});
          inserted++;
        } else {
          throw itemErr;
        }
      }
    }

    return NextResponse.json({ ok: true, count: inserted });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = body.ids || [];

    if (ids.length > 0) {
      await query("DELETE FROM fb_groups WHERE id = ANY($1)", [ids]);
    } else if (body.all) {
      await query("DELETE FROM fb_groups");
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

