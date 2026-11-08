import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import { normalizeGroupUrl } from "@/lib/autopost";
import type { FbGroup } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(req, async (user) => {
    const groups = await withUser(user.id, async (client) => {
      const res = await client.query(
        `
        SELECT 
          id, 
          name, 
          url, 
          source,
          extract(epoch from created_at) * 1000 AS "createdAt"
        FROM fb_groups
        WHERE user_id = $1
        ORDER BY created_at DESC;
      `,
        [user.id]
      );

      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        source: r.source as "auto" | "import" | "manual",
        createdAt: Math.round(Number(r.createdAt)),
      }));
    });

    return NextResponse.json({ ok: true, groups });
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
    await withUser(user.id, async (client) => {
      for (const item of deduped) {
        try {
          // 1. Cek apakah sudah ada baris di database milik user ini dengan ID atau URL yang sama
          const existing = await client.query<{ id: string; url: string }>(
            `SELECT id, url FROM fb_groups WHERE user_id = $1 AND (id = $2 OR lower(url) = lower($3)) LIMIT 2`,
            [user.id, item.id, item.url]
          );

          if (existing.rows.length === 0) {
            // Belum ada sama sekali: INSERT baru
            try {
              await client.query(
                `
                INSERT INTO fb_groups (user_id, id, name, url, source, created_at)
                VALUES ($1, $2, $3, $4, $5, now())
                ON CONFLICT (user_id, id) DO UPDATE
                SET name = EXCLUDED.name,
                    url = EXCLUDED.url,
                    source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE EXCLUDED.source END;
                `,
                [user.id, item.id, item.name, item.url, item.source]
              );
            } catch (insertErr: any) {
              if (insertErr.code === "23505" || insertErr.message?.includes("unique constraint")) {
                await client.query(
                  `
                  UPDATE fb_groups
                  SET name = $1,
                      source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE $2 END
                  WHERE user_id = $3 AND (lower(url) = lower($4) OR id = $5)
                  `,
                  [item.name, item.source, user.id, item.url, item.id]
                );
              } else {
                throw insertErr;
              }
            }
          } else {
            // Sudah ada baris yang cocok berdasarkan ID atau URL milik user ini
            const primaryId = existing.rows[0].id;

            if (existing.rows.length > 1) {
              const extraIds = existing.rows.slice(1).map((r) => r.id);
              await client.query(`DELETE FROM fb_groups WHERE user_id = $1 AND id = ANY($2)`, [user.id, extraIds]);
            }

            await client.query(
              `
              UPDATE fb_groups
              SET name = $1,
                  url = $2,
                  source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE $3 END
              WHERE user_id = $4 AND id = $5
              `,
              [item.name, item.url, item.source, user.id, primaryId]
            );
          }
          inserted++;
        } catch (itemErr: any) {
          if (itemErr.code === "23505" || itemErr.message?.includes("unique constraint")) {
            await client.query(
              `
              UPDATE fb_groups
              SET name = $1,
                  source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE $2 END
              WHERE user_id = $3 AND (id = $4 OR lower(url) = lower($5))
              `,
              [item.name, item.source, user.id, item.id, item.url]
            ).catch(() => {});
            inserted++;
          } else {
            throw itemErr;
          }
        }
      }
    });

    return NextResponse.json({ ok: true, count: inserted });
  });
}

export async function DELETE(req: NextRequest) {
  return withAuth(req, async (user) => {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {}

    const ids: string[] = body.ids || [];

    await withUser(user.id, async (client) => {
      if (ids.length > 0) {
        await client.query("DELETE FROM fb_groups WHERE user_id = $1 AND id = ANY($2)", [user.id, ids]);
      } else if (body.all) {
        await client.query("DELETE FROM fb_groups WHERE user_id = $1", [user.id]);
      }
    });

    return NextResponse.json({ ok: true });
  });
}
