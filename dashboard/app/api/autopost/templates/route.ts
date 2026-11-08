import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/server/guard";
import { withUser } from "@/lib/server/pg";
import type { PostTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuth(req, async (user) => {
    const templates = await withUser(user.id, async (client) => {
      const res = await client.query(
        `
        SELECT 
          id, 
          name, 
          body, 
          images,
          extract(epoch from created_at) * 1000 AS "createdAt",
          extract(epoch from updated_at) * 1000 AS "updatedAt"
        FROM post_templates
        WHERE user_id = $1
        ORDER BY created_at DESC;
      `,
        [user.id]
      );

      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        body: r.body,
        images: Array.isArray(r.images) ? r.images : [],
        createdAt: Math.round(Number(r.createdAt)),
        updatedAt: Math.round(Number(r.updatedAt)),
      })) as PostTemplate[];
    });

    return NextResponse.json({ ok: true, templates });
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

    const id = body.id || "tpl_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    const name = (body.name || "Template tanpa judul").trim();
    const content = (body.body || "").slice(0, 5000);
    const images = Array.isArray(body.images) ? JSON.stringify(body.images) : "[]";

    await withUser(user.id, async (client) => {
      await client.query(
        `
        INSERT INTO post_templates (user_id, id, name, body, images, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
        ON CONFLICT (user_id, id) DO UPDATE
        SET name = EXCLUDED.name,
            body = EXCLUDED.body,
            images = EXCLUDED.images,
            updated_at = now();
        `,
        [user.id, id, name, content, images]
      );
    });

    return NextResponse.json({ ok: true, id });
  });
}
