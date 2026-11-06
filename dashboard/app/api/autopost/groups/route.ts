import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
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

    let inserted = 0;
    for (const g of items) {
      if (!g.url || !g.name) continue;
      const id = g.id || "grp_" + Math.random().toString(36).slice(2, 10);
      const source = g.source || "manual";

      await query(
        `
        INSERT INTO fb_groups (id, name, url, source, created_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (url) DO UPDATE
        SET name = EXCLUDED.name,
            source = CASE WHEN fb_groups.source = 'auto' THEN 'auto' ELSE EXCLUDED.source END;
        `,
        [id, g.name.trim(), g.url.trim(), source]
      );
      inserted++;
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

