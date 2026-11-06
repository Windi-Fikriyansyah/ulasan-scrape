import { NextResponse, type NextRequest } from "next/server";
import { checkGuard } from "@/lib/server/guard";
import { query } from "@/lib/server/pg";
import type { PostTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const res = await query(`
      SELECT 
        id, 
        name, 
        body, 
        images,
        extract(epoch from created_at) * 1000 AS "createdAt",
        extract(epoch from updated_at) * 1000 AS "updatedAt"
      FROM post_templates
      ORDER BY created_at DESC;
    `);

    const templates: PostTemplate[] = res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      body: r.body,
      images: Array.isArray(r.images) ? r.images : [],
      createdAt: Math.round(Number(r.createdAt)),
      updatedAt: Math.round(Number(r.updatedAt)),
    }));

    return NextResponse.json({ ok: true, templates });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = checkGuard(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const id = body.id || "tpl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    const name = (body.name || "Template tanpa judul").trim();
    const content = (body.body || "").slice(0, 5000);
    const images = Array.isArray(body.images) ? JSON.stringify(body.images) : "[]";

    await query(
      `
      INSERT INTO post_templates (id, name, body, images, created_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, now(), now())
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          body = EXCLUDED.body,
          images = EXCLUDED.images,
          updated_at = now();
      `,
      [id, name, content, images]
    );

    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

